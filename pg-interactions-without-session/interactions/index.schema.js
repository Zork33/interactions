import {validate, VType} from '../../common/validation'
import {IN_PROGRESS, COMPLETED, FAILED, CANCELLED} from './_states'

const hasOwnProperty = Object.prototype.hasOwnProperty;

export const Interaction = {
  process: {type: VType.String().notEmpty()}, // context вазова interaction.process
  context: {type: VType.String().notEmpty()}, // контекст вызова обработки конкретного interaction
  parentId: {type: VType.Int()},
  name: {type: VType.String().notEmpty()},
  fromService: {required: true, type: VType.String().notEmpty()},
  toService: {required: true, type: VType.String().notEmpty()},
  action: {required: true, type: VType.String().notEmpty()},
  state: {
    required: true,
    type: VType.String(),
    validate: v => [IN_PROGRESS, COMPLETED, FAILED, CANCELLED].indexOf(v) >= 0 ? true : `invalid state '${v}'`
  },
  _final: false,
};

export const create_args = validate.method.this('args', {
  context: {type: VType.String()},
  parent: {
    fields: {
      id: {required: true, type: VType.Int()},
      _final: false,
    }
  },
  name: {type: VType.String().notEmpty()},
  fromService: {required: true, type: VType.String().notEmpty()},
  toService: {required: true, type: VType.String().notEmpty()},
  action: {required: true, type: VType.String().notEmpty()},
  singleton: {type: VType.Boolean()},
  completed: {type: VType.Boolean()},
  cancelled: {type: VType.Boolean()},
  error: {type: VType.Any()},
  processAt: {type: VType.String().iso8601()},
  processIn: {type: VType.Int()},
  _final: false,
  // _validate: v => { // TODO: Добавить поддержку _validate на уровень fields
  //   if (hasOwnProperty.call(v, 'parent'))
  //     return hasOwnProperty.call(v, 'name') ? undefined : `'name' prop is required, if 'parent' presents`;
  // }
});

export const update_args = validate.method.this('args', {
  context: {type: VType.String()},
  id: {required: true, type: VType.Int()},
  parentId: {type: VType.Int()},
  completed: {type: VType.Boolean()},
  cancelled: {type: VType.Boolean()},
  error: {type: VType.Any()},
  processAt: {type: VType.String().iso8601()},
  processIn: {type: VType.Int()},
  _final: false,
});

export const get_args = validate.method.this('args', {
  context: {type: VType.String()},
  id: {required: true, type: VType.Int()},
  _final: true,
});

export const getChild_args = validate.method.this('args', {
  context: {type: VType.String()},
  parentId: {required: true, type: VType.Int()},
  name: {required: true, type: VType.String().notEmpty()},
  limit: {type: VType.Int().positive()},
  _final: true,
});

export const getByMessageId_args = validate.method.this('args', {
  context: {type: VType.String()},
  messageId: {required: true, type: VType.String().notEmpty()},
  _final: true,
});

export const DEFAULT_INTERVAL = 1000;
export const DEFAULT_MAX_IN_PARALLEL = 4;
export const DEFAULT_LOCK_PERIOD = 30000;
export const DEFAULT_RELOCK_PERIOD = 15000;
// export const DEFAULT_REGULAR_CHECK_PERIOD = 20000; // вернуть значение, когда появится реакция на изменение в postgres
export const DEFAULT_REGULAR_CHECK_PERIOD = 500;
// export const DEFAULT_ON_ERROR_PROCESSING_DELAY = 10000;
export const DEFAULT_MAX_PROCESSING_TIME = 300000;

export const process_args = validate.method.this('args', {
  context: {type: VType.String()},
  interval: {type: VType.Int().positive()}, // ms - default 1 sec (1 000 ms)
  maxPerInterval: {type: VType.Int().positive()}, // none
  maxInParaller: {null: true, type: VType.Int().positive()}, // default: 10
  lockPeriod: {type: VType.Int().positive()}, // default: 5 sec (5 000 ms)
  relockPeriod: {type: VType.Int().positive()}, // default: 3 sec (3 000 ms)
  regularCheckPeriod: {null: true, type: VType.Int().positive()}, // default: 20 sec (20 000ms)
  maxProcessingTime: {type: VType.Int().positive()}, // default: 300 sec (300 000 ms)
  toService: {required: true, type: VType.String().notEmpty()},
  action: {type: VType.String().notEmpty()},
  processor: {required: true, type: VType.Function()},
  errorHandler: {type: VType.Function()},
  debug: {type: VType.Boolean()},
  _final: true,
  _validate: (value, message, validateOptions) => {
    if (!message && (value.lockPeriod || value.relockPeriod)) {
      const lockPeriod = value.lockPeriod || DEFAULT_LOCK_PERIOD;
      const relockPeriod = value.relockPeriod || DEFAULT_RELOCK_PERIOD;
      if (!(lockPeriod > relockPeriod))
        return [`lockPeriod (${lockPeriod}) must be grater then relockPeriod (${relockPeriod})`];
    }
  }
});
