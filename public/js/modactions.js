// Действия модератора над игрой — используются на странице игры и в панели модерации.
import { api, toast, toastError, promptBox, confirmBox } from './lib.js';

export async function approveGame(id) {
  try {
    await api(`/mod/games/${id}/approve`, { method: 'POST' });
    toast('Игра одобрена и опубликована');
    return true;
  } catch (e) {
    toastError(e);
    return false;
  }
}

export async function rejectGame(id, { unpublish = false } = {}) {
  const reason = await promptBox(unpublish ? 'Снять игру с публикации' : 'Отклонить игру', {
    placeholder: 'Причина — её увидит разработчик',
    ok: unpublish ? 'Снять' : 'Отклонить',
    danger: true,
  });
  if (!reason) return false;
  try {
    await api(`/mod/games/${id}/reject`, { method: 'POST', body: { reason } });
    toast(unpublish ? 'Игра снята с публикации' : 'Игра отклонена');
    return true;
  } catch (e) {
    toastError(e);
    return false;
  }
}

export async function toggleFeature(id) {
  try {
    const r = await api(`/mod/games/${id}/feature`, { method: 'POST' });
    toast(r.featured ? 'Добавлено в «Выбор HYTEAM»' : 'Убрано из «Выбора HYTEAM»');
    return true;
  } catch (e) {
    toastError(e);
    return false;
  }
}

export async function deleteGame(id, title) {
  const ok = await confirmBox(`Удалить «${title}»?`, {
    ok: 'Удалить навсегда',
    danger: true,
    note: 'Игра, её файлы, скриншоты и отзывы будут удалены без возможности восстановления.',
  });
  if (!ok) return false;
  try {
    await api(`/games/${id}`, { method: 'DELETE' });
    toast('Игра удалена');
    return true;
  } catch (e) {
    toastError(e);
    return false;
  }
}
