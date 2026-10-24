// Задать новый пароль пользователю (если забыли пароль админа): npm run set-password -- логин новый_пароль
// Работает с базой из DATA_DIR (по умолчанию папка data проекта). Выходит из аккаунта на всех устройствах.
import { one, run } from './db.js';
import { hashPassword } from './auth.js';

const [username, password] = process.argv.slice(2);
if (!username || !password) {
  console.log('Использование: npm run set-password -- логин новый_пароль');
  process.exit(1);
}
if (password.length < 6) {
  console.log('Пароль: минимум 6 символов');
  process.exit(1);
}
const u = one('SELECT id, username FROM users WHERE username = ? OR email = ?', username, username.toLowerCase());
if (!u) {
  console.log(`Пользователь «${username}» не найден`);
  process.exit(1);
}
run('UPDATE users SET password_hash = ?, email_verified = 1 WHERE id = ?', hashPassword(password), u.id);
run('DELETE FROM sessions WHERE user_id = ?', u.id);
console.log(`Готово: пароль пользователя ${u.username} изменён. Войдите с новым паролем.`);
