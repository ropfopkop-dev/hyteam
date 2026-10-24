export const state = {
  user: null,
  meta: { genres: [], platforms: [], maxGameMb: 0 },
  unread: 0,
  modPending: 0,
};

export const isMod = () => state.user?.role === 'moderator' || state.user?.role === 'admin';
export const isAdmin = () => state.user?.role === 'admin';
