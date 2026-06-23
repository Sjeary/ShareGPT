import { merge as diff3 } from 'node-diff3'

// 整库三方合并 (base=上次同步快照, ours=本地, theirs=云端)。
// 单会话/无实时场景下, 冲突只在换端时偶发; 任何冲突都「保留双方」, 绝不静默丢数据。
export interface VaultFiles {
  [path: string]: string
}

export interface MergeReport {
  merged: VaultFiles
  fromCloud: string[] // 取自云端的文件 (本地将更新)
  keptLocal: string[] // 保留本地的文件
  autoMerged: string[] // 双改但行级自动合并成功
  conflicts: { path: string; copyPath: string }[] // 双改冲突: 本地留 ours, 云端存为副本
  deleted: string[] // 合并后应从本地删除 (云端删 + 本地未改)
  changed: boolean // 合并结果是否与 ours 不同 (决定要不要落盘/回推)
}

function conflictCopyPath(path: string): string {
  return path.replace(/\.(md|markdown)$/i, '') + ' (云端冲突副本).md'
}

export function mergeVault(base: VaultFiles, ours: VaultFiles, theirs: VaultFiles): MergeReport {
  const merged: VaultFiles = {}
  const fromCloud: string[] = []
  const keptLocal: string[] = []
  const autoMerged: string[] = []
  const conflicts: { path: string; copyPath: string }[] = []
  const deleted: string[] = []

  const paths = new Set([...Object.keys(base), ...Object.keys(ours), ...Object.keys(theirs)])
  for (const p of paths) {
    const b = base[p]
    const o = ours[p]
    const t = theirs[p]
    const inB = b !== undefined
    const inO = o !== undefined
    const inT = t !== undefined

    if (inO && inT) {
      if (o === t) {
        merged[p] = o
      } else if (inB && o === b) {
        merged[p] = t
        fromCloud.push(p) // 只有云端改
      } else if (inB && t === b) {
        merged[p] = o
        keptLocal.push(p) // 只有本地改
      } else {
        // 双改 (或无共同祖先) → 行级三方合并
        const r = diff3(o.split('\n'), (b ?? '').split('\n'), t.split('\n'))
        if (!r.conflict) {
          merged[p] = r.result.join('\n')
          autoMerged.push(p)
        } else {
          merged[p] = o
          const cp = conflictCopyPath(p)
          merged[cp] = t
          conflicts.push({ path: p, copyPath: cp })
        }
      }
    } else if (inO && !inT) {
      if (inB && o === b) {
        deleted.push(p) // 云端删除, 本地未改 → 删
      } else {
        merged[p] = o // 本地新增 / 云删但本地改过 → 保留本地
        keptLocal.push(p)
      }
    } else if (!inO && inT) {
      if (inB && t === b) {
        deleted.push(p) // 本地删除, 云端未改 → 保持删除
      } else {
        merged[p] = t // 云端新增 / 本地删但云端改过 → 取云端
        fromCloud.push(p)
      }
    }
  }

  const changed = JSON.stringify(orderedKeys(merged)) !== JSON.stringify(orderedKeys(ours))
  return { merged, fromCloud, keptLocal, autoMerged, conflicts, deleted, changed }
}

function orderedKeys(files: VaultFiles): [string, string][] {
  return Object.keys(files)
    .sort()
    .map((k) => [k, files[k]] as [string, string])
}
