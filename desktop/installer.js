// Автоматическая установка программ: HYTEAM сам запускает установщик в тихом режиме,
// ставит программу в свою папку и находит её главный .exe, чтобы потом сразу открывать программу.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { shell } from 'electron';

const PS = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
const SKIP_LINK_RE = /(uninstall|удал|readme|help|справк|website|сайт|manual|license|лиценз|documentation|документац|release notes|changelog)/i;
const SKIP_EXE_RE = /(unins|uninst|setup|install|update|crash|report|helper|redist)/i;
// Код 3010 / 1641 — установка прошла, Windows просит перезагрузку.
const OK_CODES = new Set([0, 3010, 1641]);
const CANCELLED = 1223;

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-zа-яё0-9]/gi, '');
const psq = (s) => `'${String(s).replace(/'/g, "''")}'`;

function powershell(script) {
  const enc = Buffer.from(`$ProgressPreference='SilentlyContinue'; [Console]::OutputEncoding=[Text.Encoding]::UTF8\n${script}`, 'utf16le').toString('base64');
  return new Promise((resolve) => {
    execFile(PS, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', enc],
      { windowsHide: true, maxBuffer: 32 * 1024 * 1024 },
      (err, stdout, stderr) => resolve({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout: String(stdout), stderr: String(stderr) }));
  });
}

/** Тип установщика по содержимому файла. null — это не установщик (портативная программа). */
export async function installerKind(file) {
  if (/\.msi$/i.test(file)) return 'msi';
  if (!/\.exe$/i.test(file)) return null;
  const fh = await fsp.open(file, 'r');
  let head;
  try {
    const buf = Buffer.alloc(Math.min(8 * 1024 * 1024, (await fh.stat()).size));
    await fh.read(buf, 0, buf.length, 0);
    head = buf.toString('latin1');
  } finally {
    await fh.close();
  }
  const name = path.basename(file);
  if (head.includes('Inno Setup')) return 'inno';
  if (head.includes('Nullsoft') || head.includes('NSIS Error')) return 'nsis';
  if (head.includes('.wixburn')) return 'burn';
  if (/^7z\d/i.test(name) && head.includes('7-Zip')) return 'sevenzip';
  if (/^(firefox|thunderbird) setup/i.test(name)) return 'mozilla';
  if (/chrome|brave/i.test(name)) return 'omaha';
  if (/^winrar/i.test(name)) return 'winrar';
  if (/^docker desktop installer/i.test(name)) return 'docker';
  // Squirrel (Discord, Postman, GitHub Desktop) ставит программу сам и без вопросов.
  if (head.includes('Squirrel')) return 'squirrel';
  if (/^vs_|rustup-init|jetbrains-toolbox|^virtualbox-.*-win\.exe$|^tcmd\d+/i.test(name)) return 'generic';
  // Прочие установщики (свои у Zoom, Яндекса, Adobe, InstallShield…) запускаем как есть — пользователь пройдёт их сам.
  if (head.includes('InstallShield') || /setup|set-up|install|установ|^yandex|galaxy/i.test(name)) return 'generic';
  return null;
}

function silentArgs(kind, file, dir) {
  switch (kind) {
    case 'nsis': return { exe: file, args: `/S /D=${dir}` }; // /D — без кавычек и строго последним
    // /SILENT и /passive: вопросов нет, но окно с ходом установки видно.
    case 'inno': return { exe: file, args: `/SILENT /SUPPRESSMSGBOXES /NORESTART /SP- /DIR="${dir}"` };
    case 'msi': return { exe: 'msiexec.exe', args: `/i "${file}" /passive /norestart INSTALLDIR="${dir}" INSTALLFOLDER="${dir}" APPLICATIONFOLDER="${dir}"` };
    case 'burn': return { exe: file, args: '/passive /norestart' };
    case 'sevenzip': return { exe: file, args: `/S /D=${dir}` };
    case 'mozilla':
    case 'winrar': return { exe: file, args: '/S' };
    case 'omaha': return { exe: file, args: '/silent /install' };
    case 'squirrel': return { exe: file, args: '--silent' };
    case 'docker': return { exe: file, args: 'install --quiet --accept-license' };
    default: return { exe: file, args: '' }; // неизвестный установщик — пользователь пройдёт его сам
  }
}

/**
 * Запуск через Start-Process: если установщику нужны права администратора, Windows сама покажет запрос UAC.
 * Ждём только сам установщик (WaitForExit), а не все запущенные им процессы: -Wait висит,
 * если установщик в конце открыл программу или запустил службу. Возвращает код выхода.
 */
async function runProcess(exe, args) {
  const r = await powershell(`try {
  $p = Start-Process -FilePath ${psq(exe)} ${args ? `-ArgumentList ${psq(args)}` : ''} -PassThru
  $null = $p.Handle
  $p.WaitForExit()
  exit $p.ExitCode
} catch { [Console]::Error.WriteLine($_.Exception.Message); exit ${CANCELLED} }`);
  return r.code;
}

/**
 * Файл скачан из магазина HYTEAM — снимаем пометку «загружено из интернета» (как Steam и другие лаунчеры).
 * Иначе Windows перед запуском показывает окно SmartScreen, которое из фонового процесса не видно, и установка висит.
 */
export async function unblock(file) {
  await fsp.rm(`${file}:Zone.Identifier`, { force: true }).catch(() => {});
}

// ---------- Что появилось в системе после установки ----------

const START_DIRS = () => [
  path.join(process.env.APPDATA || '', 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
  path.join(process.env.ProgramData || 'C:\\ProgramData', 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
  path.join(os.homedir(), 'Desktop'),
  path.join(process.env.PUBLIC || 'C:\\Users\\Public', 'Desktop'),
];

async function listLinks() {
  const out = new Map();
  async function walk(d, depth) {
    if (depth > 3) return;
    let ents;
    try {
      ents = await fsp.readdir(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of ents) {
      const p = path.join(d, ent.name);
      if (ent.isDirectory()) await walk(p, depth + 1);
      else if (/\.lnk$/i.test(ent.name)) {
        try {
          out.set(p, (await fsp.stat(p)).mtimeMs);
        } catch {
          /* ярлык удалили во время обхода */
        }
      }
    }
  }
  for (const d of START_DIRS()) await walk(d, 0);
  return out;
}

async function listUninstall() {
  const keys = ['HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*', 'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*', 'HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*'];
  const r = await powershell(`@(Get-ItemProperty ${keys.map(psq).join(', ')} -ErrorAction SilentlyContinue | Where-Object DisplayName |
  Select-Object PSPath, DisplayName, DisplayIcon, InstallLocation, UninstallString, QuietUninstallString) | ConvertTo-Json -Compress -Depth 2`);
  try {
    const list = JSON.parse(r.stdout.trim() || '[]');
    return Array.isArray(list) ? list : [list];
  } catch {
    return [];
  }
}

export async function systemSnapshot() {
  const [links, apps] = await Promise.all([listLinks(), listUninstall()]);
  return { links, apps: new Set(apps.map((a) => a.PSPath)) };
}

function iconExe(icon) {
  const m = String(icon || '').replace(/"/g, '').match(/^(.+?\.exe)(,\s*-?\d+)?$/i);
  return m && fs.existsSync(m[1]) && !SKIP_EXE_RE.test(path.basename(m[1])) ? m[1] : null;
}

/** Главный .exe и команда удаления программы, которую только что поставил установщик. */
export async function detectInstalled(before, title) {
  const t = norm(title);
  const similar = (s) => {
    const n = norm(s);
    return !!t && !!n && (n.includes(t) || t.includes(n));
  };
  const result = { exe: null, uninstall: '', location: '' };

  const apps = (await listUninstall()).filter((a) => !before.apps.has(a.PSPath) || similar(a.DisplayName));
  apps.sort((a, b) => Number(similar(b.DisplayName)) - Number(similar(a.DisplayName)));
  const app = apps[0];
  if (app) {
    result.uninstall = app.QuietUninstallString || app.UninstallString || '';
    result.location = String(app.InstallLocation || '').replace(/"/g, '');
  }

  // Ярлык в «Пуске» или на рабочем столе — самый надёжный указатель на главную программу.
  const links = [];
  for (const [p, mtime] of await listLinks()) {
    if (before.links.get(p) === mtime || SKIP_LINK_RE.test(path.basename(p))) continue;
    try {
      const target = shell.readShortcutLink(p).target;
      if (/\.exe$/i.test(target) && fs.existsSync(target) && !SKIP_EXE_RE.test(path.basename(target))) links.push({ p, target });
    } catch {
      /* ярлык на страницу или повреждён */
    }
  }
  links.sort((a, b) => Number(similar(path.basename(b.p, '.lnk'))) - Number(similar(path.basename(a.p, '.lnk'))));
  result.exe = links[0]?.target || iconExe(app?.DisplayIcon) || null;
  return result;
}

/** Запустить установщик. Бросает ошибку, если установка не удалась или отменена. */
export async function runInstaller(file, kind, dir) {
  await fsp.mkdir(dir, { recursive: true });
  await unblock(file);
  const { exe, args } = silentArgs(kind, file, dir);
  const code = await runProcess(exe, args);
  if (code === CANCELLED) throw new Error('Установка отменена');
  if (!OK_CODES.has(code)) throw new Error(`Установщик завершился с ошибкой (код ${code})`);
}

/** Удаление программы через её собственный деинсталлятор (тихо, если умеем). */
export async function runUninstaller(cmd, kind) {
  const s = String(cmd || '').trim();
  if (!s) return;
  const m = s.match(/^"([^"]+)"\s*(.*)$/) || s.match(/^(.+?\.exe)\s*(.*)$/i);
  if (!m) return;
  let [, exe, args] = m;
  if (/msiexec/i.test(exe)) args = `${args.replace(/\/I\{/i, '/X{')} /passive /norestart`;
  else if (kind === 'inno' && !/VERYSILENT/i.test(args)) args = `${args} /VERYSILENT /SUPPRESSMSGBOXES /NORESTART`;
  else if (kind === 'nsis' && !/(^|\s)\/S(\s|$)/.test(args)) args = `${args} /S`;
  await runProcess(exe, args.trim());
}
