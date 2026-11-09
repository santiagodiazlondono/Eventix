-- Allow account holders to deactivate accounts while preserving reservations and events.
ALTER TABLE persona
  ADD COLUMN IF NOT EXISTS cuenta_eliminada_at TIMESTAMPTZ;
