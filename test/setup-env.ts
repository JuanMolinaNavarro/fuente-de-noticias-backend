import { TEST_DATABASE_URL } from './test-db';

// Corre antes de cada suite. Como dotenv NO pisa variables ya definidas,
// setear DATABASE_URL acá garantiza que la app dentro de los tests apunte
// a la base de test aunque exista .env.
process.env.DATABASE_URL = TEST_DATABASE_URL;
process.env.NODE_ENV = 'test';
