-- Guarda el motivo y la fecha de cancelación de reservas y eventos
-- para los reportes del administrador. Solo añade columnas opcionales.
BEGIN;

ALTER TABLE reserva
  ADD COLUMN IF NOT EXISTS motivo_cancelacion TEXT,
  ADD COLUMN IF NOT EXISTS fecha_cancelacion TIMESTAMPTZ;

ALTER TABLE evento
  ADD COLUMN IF NOT EXISTS motivo_cancelacion TEXT,
  ADD COLUMN IF NOT EXISTS fecha_cancelacion TIMESTAMPTZ;

COMMIT;
