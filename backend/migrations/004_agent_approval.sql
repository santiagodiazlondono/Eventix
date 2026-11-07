BEGIN;

ALTER TABLE agente
  ADD COLUMN IF NOT EXISTS estado_aprobacion VARCHAR(20) NOT NULL DEFAULT 'aprobado',
  ADD COLUMN IF NOT EXISTS fecha_solicitud TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN IF NOT EXISTS fecha_resolucion TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS resuelto_por VARCHAR(20),
  ADD COLUMN IF NOT EXISTS motivo_rechazo TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'agente_estado_aprobacion_valido'
      AND conrelid = 'agente'::regclass
  ) THEN
    ALTER TABLE agente
      ADD CONSTRAINT agente_estado_aprobacion_valido
      CHECK (estado_aprobacion IN ('pendiente', 'aprobado', 'rechazado'));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'agente_resuelto_por_administrador'
      AND conrelid = 'agente'::regclass
  ) THEN
    ALTER TABLE agente
      ADD CONSTRAINT agente_resuelto_por_administrador
      FOREIGN KEY (resuelto_por)
      REFERENCES administrador (identificacion);
  END IF;
END
$$;

COMMIT;
