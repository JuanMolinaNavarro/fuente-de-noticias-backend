import { execSync } from 'node:child_process';
import { TEST_DATABASE_URL } from './test-db';

/**
 * Corre UNA vez antes de toda la corrida e2e:
 *  1. crea la base de test si no existe (vía SQL contra la base "postgres")
 *  2. le aplica todas las migraciones (prisma migrate deploy)
 */
export default function globalSetup() {
  const adminUrl = TEST_DATABASE_URL.replace(
    '/frente_noticias_test',
    '/postgres',
  );
  try {
    execSync(`npx prisma db execute --url "${adminUrl}" --stdin`, {
      input: 'CREATE DATABASE frente_noticias_test;',
      stdio: 'pipe',
    });
  } catch {
    // ya existe: perfecto
  }
  execSync('npx prisma migrate deploy', {
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
    stdio: 'inherit',
  });
}
