-- !Downs

DROP TABLE IF EXISTS interaction CASCADE;

-- !Ups

CREATE TABLE interaction (

  id SERIAL NOT NULL PRIMARY KEY,

  -- родительский interaction, у которого устанавливается признак dirty, когда изменяется состояние этого interaction
  parent_id INTEGER,

  -- имя этого interaction для parent
  name VARCHAR(100),

  -- как
  from_service VARCHAR(100) NOT NULL,

  -- для какого сервиса
  to_service VARCHAR(100) NOT NULL,

  -- имя действия
  action VARCHAR(100) NOT NULL,

  -- true, если interaction выполняется как часть состояния parent interaction.
  inner_action BOOLEAN NOT NULL DEFAULT false,

  -- идентификатор сообщения в канале, чтобы при работе с telegram и emby, можно было легче найти interaction, который создал и сопровождает данное сообщение
  message_id VARCHAR(100),

  -- если не null и значение меньше now(), то требуется обработка interaction
  next_processing TIMESTAMP,

  -- true, если interaction завершена
  completed BOOLEAN NOT NULL DEFAULT false,

  -- true, если результат ошибка
  failed BOOLEAN NOT NULL DEFAULT false,

  -- true, если interaction было отменено
  cancelled BOOLEAN NOT NULL DEFAULT false,

  -- время до которого данный объект заблокирован кодом, который с ним работает
  lock TIMESTAMP NOT NULL DEFAULT to_timestamp(0),

  -- данные сообщения в JSON
  options JSONB,

  -- когда создан
  created TIMESTAMP NOT NULL,

  -- когда изменен
  modified TIMESTAMP NOT NULL

);

CREATE UNIQUE INDEX ON interaction (id);

ALTER TABLE interaction ADD CONSTRAINT fk_parent FOREIGN KEY (parent_id) REFERENCES interaction(id) DEFERRABLE;

CREATE INDEX ON interaction (from_service);

CREATE INDEX ON interaction (to_service);

CREATE INDEX ON interaction (parent_id, name);

CREATE INDEX ON interaction (message_id);

CREATE INDEX ON interaction (completed);

CREATE INDEX ON interaction (failed);

CREATE INDEX ON interaction (lock);

CREATE INDEX ON interaction (next_processing);
