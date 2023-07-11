import {nanoid} from 'nanoid'
import {missingService} from '../../common/services'
import errorDataToEvent from '../../common/errors/errorDataToEvent'
import rowToInteraction from './_rowToInteraction'
import fixServiceName from './_fixServiceName'
import prettyPrint from '../../common/utils/prettyPrint'

const schema = require('./index.schema');

export default function (services) {

  const {
    bus = missingService('bus'),
    postgres = missingService('postgres'),
    testMode,
  } = services;

  const isTestMode = testMode && testMode.interaction;
  let testAsyncQueue = [];

  function process(args) {
    schema.process_args(args);

    // TODO: Generate filter key - to ensure that there is no processing of the same iteractions in one node
    // TODO: Add function, what tells from postgres event - is this interaction is sutable for this queue

    let {
      context,
      interval = schema.DEFAULT_INTERVAL,
      maxPerInterval,
      maxInParaller = schema.DEFAULT_MAX_IN_PARALLEL,
      lockPeriod = schema.DEFAULT_LOCK_PERIOD,
      relockPeriod = schema.DEFAULT_RELOCK_PERIOD,
      regularCheckPeriod = schema.DEFAULT_REGULAR_CHECK_PERIOD,
      maxProcessingTime = schema.DEFAULT_MAX_PROCESSING_TIME,
      toService,
      action,
      processor,
      errorHandler,
      debug,
    } = args;

    toService = fixServiceName(toService);

    const processId = context;

    const evProcess = {
      type: 'ia.process',
      service: this._service.name,

      process: processId,

      interval,
      maxPerInterval,
      maxInParaller,
      lockPeriod,
      relockPeriod,
      regularCheckPeriod,
      maxProcessingTime,
      toService,
      action,
    };
    if (this._serviceType) evProcess.serviceType = this._serviceType;
    bus.event(evProcess);

    const extendLock = _buildExtendLock();
    const next = _buildNext();

    const self = this;

    let currentlyRunning = 0;
    const processTimes = maxPerInterval ? [] : undefined;
    let maxPerIntervalTimer = null;
    let regularCheckPeriodTimer = null;

    let stopPromise;
    let stopResolve;

    // TODO: Wait for signal from postgres

    const _processNextWrapped = () => _processNext().catch(_reportError);
    const processNext = isTestMode ? () => {
      testAsyncQueue.push(_processNextWrapped)
    } : _processNextWrapped;

    // запускаем процесс
    processNext();

    // возвращаем метод для корректной остановки обработки - пока все не выполнятся
    return async function stopProcess() {
      if (!stopPromise) {
        stopPromise = new Promise(function (resolve, reject) {
          stopResolve = resolve;
        })
      }
      return stopPromise;
    };

    async function _processNext() {

      // процесс в состоянии завершения работы, потому новые обработки не начинаем
      if (stopResolve) {
        if (currentlyRunning === 0) {
          stopResolve();
        }
        return;
      }

      // если ограничение по паралельно запущенным процессам
      if (maxInParaller && maxInParaller <= currentlyRunning) return;

      // если ограничение по количеству вызовов в указанный интервал времени
      if (processTimes) {
        if (maxPerIntervalTimer !== null) {
          clearTimeout(maxPerIntervalTimer);
          maxPerIntervalTimer = null;
        }
        let v;
        if (processTimes.length === maxPerInterval && (v = Date.now() - processTimes[maxPerInterval - 1]) < interval) {
          maxPerIntervalTimer = setTimeout(processNext, interval - v);
          return;
        }
      }

      // чистит регулярный таймер
      if (regularCheckPeriodTimer !== null) {
        clearTimeout(regularCheckPeriodTimer);
        regularCheckPeriodTimer = null;
      }

      // введем подсчет interaction'ов которые в обработке
      currentlyRunning++;

      // пытаемся взять следующий intercation на обработку
      const interaction = await next({context});

      // если не удалось взять очередной interaction на обработку - ничего не далаем
      if (!interaction) {
        // ставим таймер, если регулярная проверка БД включена
        if (regularCheckPeriod)
          regularCheckPeriodTimer = setTimeout(processNext, regularCheckPeriod);
        currentlyRunning--;
        return;
      }

      // если есть ограничение по количествую обработок за интервал, учитываем время начала каждой новой обработке в списке
      if (processTimes) {
        processTimes.unshift(Date.now());
        if (processTimes.length > maxPerInterval) processTimes.length = maxPerInterval;
      }

      const reportError = (err) => _reportError(err, errorHandler, interaction);

      // перед тем как начать обработку взятого interaction, делаем ещё одную попытку взять другой interaction на обработку
      processNext();

      // включаем таймер, чтобы если обработка затянется, то параллельно продлевать блокировку interaction в БД
      let extendLockTimer;

      // признак что обработка завершена.  есть предположение что иногда после завершения обработки, случается продление блокировки, так как вызов уже успел попасть в очередь, но обрабатывает после ia.end
      let finished = false;

      const testableExtendTimeout = isTestMode ? (() => testAsyncQueue.push(extendTimeout)) : extendTimeout;

      async function extendTimeout() { // async нужен для работы в тестах, когда надо дождаться завершения extendLock(...)
        if (!finished) {
          return extendLock(context, interaction).then(() => {
            extendLockTimer = setTimeout(testableExtendTimeout, relockPeriod);
          }, reportError);
        }
      }

      extendLockTimer = setTimeout(testableExtendTimeout, relockPeriod);

      if (testMode) {
        // в тестовом режиме, обработка выбранного interaction это отдельный шаг, который начинается когда
        processor(interaction, (err) => { // в тестовом режиме передаем testProcessFinished callback, чтобы можно было синхронно (Promise это с задержкой) сказать что process завершился
          testAsyncQueue.push(() => processInteraction(err));
        });
      } else {
        return processInteraction();
      }

      async function processInteraction(err) {

        const startTime = Date.now();

        try {
          // выполняем обработку
          if (isTestMode) {
            if (err) throw err;
          } else {
            interaction.process = processId;
            const context = interaction.context;

            const evStart = {
              type: 'ia.start',
              service: self._service.name,
              context,
              process: processId,
              id: interaction.id,
              toService: interaction.toService,
              action: interaction.action,
              ia: interaction,
            };
            if (self._serviceType) evStart.serviceType = self._serviceType;
            bus.event(evStart);

            try {
              await processor(interaction);
            } catch (err) {
              interaction.error = err;
            }

            if (interaction.error) {
              reportError(interaction.error);
            }

            // выключаем продление блокировки
            finished = true;
            clearTimeout(extendLockTimer);

            await self._update(interaction);

            const evEnd = {
              type: 'ia.end',
              service: self._service.name,
              context,
              process: processId,
              id: interaction.id,
              toService: interaction.toService,
              action: interaction.action,
              ia: interaction,
              completed: interaction.completed,
              processIn: interaction.processIn,
              processAt: interaction.processAt,
              duration: Date.now() - startTime,
            };
            if (interaction.error) errorDataToEvent(interaction.error, evEnd);
            if (self._serviceType) evEnd.serviceType = self._serviceType;

            bus.event(evEnd);
          }

        } finally {
          // выключаем продление блокировки
          finished = true;
          clearTimeout(extendLockTimer);

          if (maxProcessingTime) {
            const duration = Date.now() - startTime;
            if (duration > maxProcessingTime) {
              const evTooLong = {
                type: 'ia.error',
                kind: 'tooLong',
                service: self._service.name,
                context,
                process: processId,
                id: interaction.id,
                toService: interaction.toService,
                action: interaction.action,
                ia: interaction,
                duration,
                maxProcessingTime,
              };
              if (self._serviceType) evTooLong.serviceType = self._serviceType;
              bus.error(evTooLong);
            }
          }

          if (--currentlyRunning === 0 && stopResolve) {
            // если закончилась последняя паралелльная обработки и есть признак, что надо остановить процесс обработки - посылаем сигнал что обработка завершена
            stopResolve();
          } else if (regularCheckPeriodTimer === null && maxPerIntervalTimer === null) {
            // иначе, если нет ожидания на одном из таймеров, пробуем запустить следующую обработку
            processNext();
          }
        }
      }
    }

    function _reportError(error, errorHandler, interaction) {
      if (errorHandler) errorHandler(error);
      if (!(error instanceof Error)) error = new Error(`Invalid argument 'error': ${prettyPrint(error)}`);
      const errEvent = {
        type: 'ia.error',
        kind: 'general',
        service: self._service.name,
        process: processId,
      };
      if (interaction) {
        errEvent.context = interaction.context;
        errEvent.id = interaction.id;
        errEvent.action = interaction.action;
        errEvent.ia = interaction;
      }
      if (self._serviceType) errEvent.serviceType = self._serviceType;
      errorDataToEvent(error, errEvent);
      bus.error(errEvent);
      // Ошибка дальше не возвращается, это план
    }

    function _buildExtendLock() {
      const statement = `with t as (select * from interaction where id = $1) update interaction set lock = now()::timestamp + (${lockPeriod} * interval '1 ms') where id = $1 returning (select extract(milliseconds from (t.lock - now())) as lockleft from t);`;
      return async function (context, interaction) {
        // zork: Специально используем exec с подчерком, чтоб эти операции не писались в graylog
        const r = await postgres._exec({
          context,
          statement,
          params: [interaction.id],
        });
        if (!isTestMode) {
          if (debug) {
            bus.debug({
              type: 'ia.extendLock',
              service: self._service.name,
              context: interaction.context,
              process: processId,
              id: interaction.id,
              toService: interaction.toService,
              action: interaction.action,
              ia: interaction,
              lockLeft: r.rows[0].lockleft,
            });
          }
          if (r.rows[0].lockleft <= 0) { // record was unlocked for some time
            bus.error({
              type: 'ia.error',
              kind: 'extendLock',
              service: self._service.name,
              context: interaction.context,
              process: processId,
              id: interaction.id,
              toService: interaction.toService,
              action: interaction.action,
              ia: interaction,
              lockLeft: r.rows[0].lockleft,
            });
         }
        }
      }
    }

    function _buildNext() {
      const statement =
        `update interaction set lock = now() + (${lockPeriod} * interval '1 ms') ` +
        `where id = (select id from interaction where to_service = $1${action ? ` and action = $2` : ''} and completed = false and now() >= next_processing and now() >= lock order by modified limit 1 for update) ` +
        `returning *;`;
      const params = [toService];
      if (action) params.push(action);
      const args = {statement, params};
      return function ({context}) {
        // zork: Специально используем exec с подчерком, чтоб эти операции не писались в graylog
        return postgres._exec({context, ...args}).then((r) => {
          if (r.rowCount > 0) return rowToInteraction(r.rows[0]);
        });
      }
    }
  }

  if (isTestMode) {
    // ожидаем выполнение всех ранее в очередь processNext()
    process._runAndAwaitAsyncs = /*async*/ () => {
      const r = Promise.all(testAsyncQueue.map(f => f()));
      testAsyncQueue = [];
      return r;
    }
  }

  return process;
}
