require("dotenv").config();
const prisma = require("../src/prisma");

async function main() {
  const res = await prisma.attendance.deleteMany({});
  console.log("Deleted attendance rows count:", res.count);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
