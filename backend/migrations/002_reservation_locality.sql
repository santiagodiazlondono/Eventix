ALTER TABLE reserva
  ADD COLUMN IF NOT EXISTS localidad VARCHAR(20) NOT NULL DEFAULT 'General';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'reserva_localidad_valida'
      AND conrelid = 'reserva'::regclass
  ) THEN
    ALTER TABLE reserva
      ADD CONSTRAINT reserva_localidad_valida
      CHECK (localidad IN ('General', 'VIP', 'Preferencial'));
  END IF;
END
$$;
