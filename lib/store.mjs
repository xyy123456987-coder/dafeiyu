// 存储层：只管「E 盘 + 读写 + 日志 + 备份」，不碰 ctx。
import { mkdirSync, readFileSync, writeFileSync, existsSync, copyFileSync, appendFileSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { resolveDataDir, pathsFor, emptyProfile } from './core.mjs'

const resolved = resolveDataDir(process.env.FEIYU_OWNER_DATA_DIR)
export const DATA_OK = resolved.ok
export const DATA_DIR = resolved.dir
export const REASON = resolved.reason
export const P = DATA_OK ? pathsFor(DATA_DIR) : null

export const DEFAULT_CFG = {
  enabled: false,
  dryRun: true,
  ownerSessions: [],
  ownerQq: [],
  ownerName: '主人',
  targetSession: '',
  digestAt: '04:30',
  maxItems: 6,
  maxChars: 600,
  speakUp: { enabled: false, cooldownMinutes: 180, quietFrom: 0, quietTo: 8, text: '想跟你说说话了。' },
  // 首次向导（见 lib/core.mjs 的 shouldAskOnboard / shouldAskInChat）
  installId: '',
  installedAt: '',
  onboardedAskedAt: null, // 对话兜底问过一次
  onboardSeenAt: null, // 弹窗真的在界面里露过脸
  onboardDismissedAt: null, // 点过「先不用」→ 以后只走设置页
  onboardBoundAt: null, // 通过弹窗完成绑定
  onboardBoundFrom: '', // 记录是从界面还是对话绑的
}

export function ensureDir() {
  if (!DATA_OK) return false
  try {
    for (const d of [DATA_DIR, P.backupDir, join(DATA_DIR, 'digests')]) mkdirSync(d, { recursive: true })
    return true
  } catch (error) {
    return false
  }
}

export function log(msg) {
  if (!DATA_OK) return
  try {
    ensureDir()
    appendFileSync(P.log, JSON.stringify({ at: new Date().toISOString(), msg: String(msg) }) + '\n', 'utf8')
  } catch (error) {}
}

function readJson(path, fallback) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    return fallback
  }
}

export function writeJson(path, value) {
  if (!DATA_OK) return false
  try {
    ensureDir()
    writeFileSync(path, JSON.stringify(value, null, 2), 'utf8')
    return true
  } catch (error) {
    log('写文件失败：' + path + ' ' + (error && error.message))
    return false
  }
}

let cache = null
export function cfg() {
  if (!cache) {
    const raw = readJson(P.config, null)
    cache = Object.assign({}, DEFAULT_CFG, raw && typeof raw === 'object' ? raw : {})
    cache.speakUp = Object.assign({}, DEFAULT_CFG.speakUp, cache.speakUp || {})
  }
  return cache
}

export function saveCfg(next) {
  cache = Object.assign({}, DEFAULT_CFG, next || {})
  cache.speakUp = Object.assign({}, DEFAULT_CFG.speakUp, cache.speakUp || {})
  return writeJson(P.config, cache)
}

export function loadProfile() {
  const raw = readJson(P.profile, null)
  return raw && Array.isArray(raw.items) ? raw : emptyProfile()
}

// 改档案前先备份；备份只留最近 20 份（上一版只备不清，已补上删除）
export function saveProfile(profile) {
  if (!DATA_OK) return false
  try {
    if (existsSync(P.profile)) {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-')
      copyFileSync(P.profile, join(P.backupDir, 'profile-' + stamp + '.json'))
      const olds = readdirSync(P.backupDir).filter((f) => f.startsWith('profile-')).sort()
      for (const f of olds.slice(0, Math.max(0, olds.length - 20))) {
        try {
          rmSync(join(P.backupDir, f), { force: true })
        } catch (error) {}
      }
    }
  } catch (error) {}
  return writeJson(P.profile, profile)
}

export function readDigest(day) {
  return readJson(P.digest(day), null)
}

export function writeDigest(day, value) {
  return writeJson(P.digest(day), value)
}
