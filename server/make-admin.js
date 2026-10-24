// Назначить пользователя администратором: npm run make-admin -- <логин>
import { one, run } from './db.js';

const username = process.argv[2];
if (!username) {
  console.log('Использование: npm run make-admin -- <логин>');
  process.exit(1);
}
const u = one('SELECT id, username FROM users WHERE username = ?', username);
if (!u) {
  console.log(`Пользователь «${username}» не найден`);
  process.exit(1);
}
run("UPDATE users SET role = 'admin', banned = 0 WHERE id = ?", u.id);
console.log(`Готово: ${u.username} теперь администратор`);
