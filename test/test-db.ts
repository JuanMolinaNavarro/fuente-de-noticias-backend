/**
 * Los e2e corren contra una base REAL pero separada (frente_noticias_test):
 * misma infraestructura que producción, cero riesgo para los datos de dev.
 */
export const TEST_DATABASE_URL =
  'postgresql://frente:frente_dev_2026@localhost:5433/frente_noticias_test';
