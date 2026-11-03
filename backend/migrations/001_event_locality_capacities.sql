ALTER TABLE evento
  ADD COLUMN IF NOT EXISTS capacidad_general INTEGER,
  ADD COLUMN IF NOT EXISTS capacidad_vip INTEGER,
  ADD COLUMN IF NOT EXISTS capacidad_preferencial INTEGER;

UPDATE evento
SET capacidad_general = capacidad_total,
    capacidad_vip = 0,
    capacidad_preferencial = 0
WHERE capacidad_general IS NULL
   OR capacidad_vip IS NULL
   OR capacidad_preferencial IS NULL;

ALTER TABLE evento
  ALTER COLUMN capacidad_general SET NOT NULL,
  ALTER COLUMN capacidad_vip SET NOT NULL,
  ALTER COLUMN capacidad_preferencial SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'evento_capacidades_no_negativas'
      AND conrelid = 'evento'::regclass
  ) THEN
    ALTER TABLE evento
      ADD CONSTRAINT evento_capacidades_no_negativas
      CHECK (
        capacidad_general >= 0
        AND capacidad_vip >= 0
        AND capacidad_preferencial >= 0
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'evento_capacidad_total_coincide'
      AND conrelid = 'evento'::regclass
  ) THEN
    ALTER TABLE evento
      ADD CONSTRAINT evento_capacidad_total_coincide
      CHECK (
        capacidad_total =
          capacidad_general + capacidad_vip + capacidad_preferencial
      );
  END IF;
END
$$;
