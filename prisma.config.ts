import { defineConfig, env } from 'prisma/config';

process.loadEnvFile();

export default defineConfig({
  datasource: {
    url: env('DATABASE_URL'),
  },
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  engine: 'classic',
});
