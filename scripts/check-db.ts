import postgres from "postgres";

const connectionString =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@localhost:5432/collaborative_learning";

async function main() {
  const client = postgres(connectionString, { max: 1 });
  await client`SELECT 1`;
  console.log("Database connection OK");
  await client.end();
}

main().catch((error) => {
  console.error("Database connection failed:", error.message);
  process.exit(1);
});
