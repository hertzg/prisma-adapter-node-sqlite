import { PrismaClient } from './generated/prisma/client.ts';
import { PrismaNodeSQLite } from '../src/index.ts';

const adapter = new PrismaNodeSQLite({
  url: 'file:./prisma/dev.db',
});
const prisma = new PrismaClient({ adapter });

await prisma.$transaction([prisma.user.deleteMany()]);

const user = await prisma.user.create({
  data: {
    name: 'John Doe',
    email: 'john.doe@example.com',
  },
});

console.log(user);

await prisma.user.findUnique({
  where: {
    id: user.id,
  },
});

console.log(user);

const post = await prisma.post.create({
  data: {
    title: 'Hello World',
    content: 'This is a test post',
    authorId: user.id,
  },
});

console.log(post);

await prisma.post.findUnique({
  where: {
    id: post.id,
  },
});

console.log(post);
