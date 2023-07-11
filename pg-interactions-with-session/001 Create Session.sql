-- Таблица сессий, пользователя

-- !Downs

DROP TABLE IF EXISTS session CASCADE;

-- !Ups

CREATE TABLE session (

  id VARCHAR(40) NOT NULL PRIMARY KEY, -- nanoid()

  -- название бота, для которого созданна эта сессия
  bot VARCHAR(100) NOT NULL,

  -- канал, через который происходит сессия - telegram, web, ...
  channel VARCHAR(100) NOT NULL,

  -- идентификатор в канале - id-telegram, session-id для web ...
  user_id VARCHAR(100) NOT NULL,

  -- когда сессия была создана
  created TIMESTAMP NOT NULL DEFAULT now(),

  -- когда последний раз проверялась активность сессии
  last_seeing TIMESTAMP NOT NULL DEFAULT now(),

  -- true, если в сессии есть не завершенные действия, которые надо продолжить после перезапуска сервера
  active BOOLEAN NOT NULL DEFAULT TRUE,

    -- время до которого данный объект заблокирован кодом, который с ним работает
  lock TIMESTAMP NOT NULL DEFAULT to_timestamp(0),

  -- данные сессии в JSON
  options JSONB

);

CREATE UNIQUE INDEX ON session (id);

CREATE INDEX ON session (channel, user_id);

CREATE INDEX ON session (last_seeing);

CREATE INDEX ON session (active);
