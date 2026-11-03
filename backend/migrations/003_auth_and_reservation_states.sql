-- Align shared accounts and reservation states with the authentication flows.
BEGIN;

ALTER TABLE persona
  ADD COLUMN IF NOT EXISTS password_hash TEXT,
  ADD COLUMN IF NOT EXISTS auth_version INTEGER NOT NULL DEFAULT 0;

UPDATE persona
SET auth_version = 0
WHERE auth_version IS NULL;

ALTER TABLE persona
  ALTER COLUMN auth_version SET DEFAULT 0,
  ALTER COLUMN auth_version SET NOT NULL;

ALTER TABLE cliente
  ALTER COLUMN cantidad_puntos SET DEFAULT 0;

CREATE UNIQUE INDEX IF NOT EXISTS persona_correo_electronico_lower_uq
  ON persona (LOWER(TRIM(correo_electronico)));

INSERT INTO estadoreserva (nombre)
SELECT 'Confirmada'
WHERE NOT EXISTS (
  SELECT 1 FROM estadoreserva WHERE LOWER(TRIM(nombre)) = 'confirmada'
);

INSERT INTO estadoreserva (nombre)
SELECT 'Cancelada'
WHERE NOT EXISTS (
  SELECT 1 FROM estadoreserva WHERE LOWER(TRIM(nombre)) = 'cancelada'
);

COMMIT;
