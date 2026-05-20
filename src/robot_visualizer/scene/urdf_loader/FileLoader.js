/**
 * URDFFileLoader — URDF 文件加载工具
 *
 * 支持三种加载方式：
 *  1. 手动选择单个 .urdf / .xml 文件
 *  2. 拖拽文件夹 → 递归扫描所有文件，返回 URDF + 资产文件映射
 *  3. 拖拽单个 .urdf 文件 → 直接加载
 *
 * 拖拽文件夹时返回：
 * {
 *   urdfFiles: [{ filename, text }],   // 所有 .urdf / .xml 文件
 *   fileMap: Map<relativePath, File>,  // 相对路径 -> File 对象（供 MeshLoader 使用）
 * }
 *
 * 典型用法：
 *   import { URDFFileLoader } from './FileLoader.js'
 *
 *   const loader = new URDFFileLoader()
 *
 *   // 方式 1：手动触发文件选择器
 *   loader.openFilePicker().then(result => { ... })
 *
 *   // 方式 2：绑定 HTML 拖拽区域
 *   loader.attachDropZone(element, {
 *     onFolderDrop: async (result) => { ... },   // result: { urdfFiles, fileMap }
 *     onFileDrop:   (entry) => { ... },        // entry: { filename, text }
 *   })
 *
 *   // 方式 3：直接加载（内部调用）
 *   const result = await loader.loadURDFFromFile(file)
 */

/** @typedef {{ filename: string, text: string }} URDFEntry */
/** @typedef {{ urdfFiles: URDFEntry[], fileMap: Map<string, File> }} FolderDropResult */

export class URDFFileLoader {
  constructor() {
    this._accept = '.urdf,.xml'
  }

  // ── 1. 文件选择器 ─────────────────────────────────────────────────────

  /**
   * 打开系统文件选择器，选择单个 .urdf / .xml 文件。
   * @returns {Promise<URDFEntry | null>}
   */
  async openFilePicker() {
    return new Promise((resolve) => {
      const input = document.createElement('input')
      input.type = 'file'
      input.accept = this._accept

      input.onchange = async () => {
        const file = input.files?.[0]
        if (!file) { resolve(null); return }
        const result = await this._readFile(file)
        resolve(result)
      }

      input.oncancel = () => resolve(null)
      input.click()
    })
  }

  // ── 2. 拖拽区域 ───────────────────────────────────────────────────────

  /**
   * 将一个 HTML 元素变成拖拽区域。
   *
   * @param {HTMLElement} element
   * @param {{
   *   onFolderDrop?: (result: FolderDropResult) => void,
   *   onFileDrop?:   (entry: URDFEntry) => void,
   *   onDragEnter?:  (e: DragEvent) => void,
   *   onDragLeave?:  (e: DragEvent) => void,
   * }} handlers
   *
   * @example
   *   const loader = new URDFFileLoader()
   *   loader.attachDropZone(document.getElementById('drop-zone'), {
   *     onFolderDrop: async ({ urdfFiles, fileMap }) => {
   *       if (urdfFiles.length === 0) return
   *       if (urdfFiles.length === 1) { loadEntry(urdfFiles[0], fileMap); return }
   *       showURDFSelector(urdfFiles, fileMap) // 用户选择
   *     },
   *     onFileDrop: (entry) => loadEntry(entry),
   *   })
   */
  attachDropZone(element, handlers = {}) {
    const { onFolderDrop, onFileDrop, onDragEnter, onDragLeave } = handlers

    element.addEventListener('dragenter', (e) => {
      e.preventDefault()
      e.stopPropagation()
      onDragEnter?.(e)
    })

    element.addEventListener('dragover', (e) => {
      e.preventDefault()
      e.stopPropagation()
    })

    element.addEventListener('dragleave', (e) => {
      e.preventDefault()
      e.stopPropagation()
      onDragLeave?.(e)
    })

    element.addEventListener('drop', async (e) => {
      e.preventDefault()
      e.stopPropagation()
      onDragLeave?.(e)

      const items = Array.from(e.dataTransfer?.items || [])
      if (items.length === 0) return

      const entries = await this._itemsToFileEntries(items)
      if (entries.length === 0) return

      if (entries.length === 1 && entries[0].file instanceof File) {
        const entry = entries[0]
        const ext = this._ext(entry.filename).toLowerCase()
        if (ext === 'urdf' || ext === 'xml') {
          const result = await this._readFile(entry.file)
          if (result) onFileDrop?.(result)
        }
      } else {
        const { urdfFiles, fileMap } = await this._buildFolderResult(entries)
        onFolderDrop?.({ urdfFiles, fileMap })
      }
    })
  }

  // ── 3. 直接加载 ───────────────────────────────────────────────────────

  /**
   * 加载一个 File 对象（来自 <input> 或拖拽）。
   * @param {File} file
   * @returns {Promise<URDFEntry | null>}
   */
  async loadURDFFromFile(file) {
    const ext = this._ext(file.name).toLowerCase()
    if (ext !== 'urdf' && ext !== 'xml') return null
    return this._readFile(file)
  }

  // ── Internal ────────────────────────────────────────────────────────

  /**
   * 从 DataTransferItemList 提取所有文件和目录。
   * @param {DataTransferItem[]} items
   * @returns {Promise<Array<{ filename: string, file: File, relativePath: string }>>}
   */
  async _itemsToFileEntries(items) {
    const results = []

    for (const item of items) {
      const entry = item.webkitGetAsEntry?.()
      if (!entry) {
        const file = item.getAsFile?.()
        if (file) results.push({ filename: file.name, file, relativePath: file.name })
        continue
      }

      if (entry.isFile) {
        const file = await this._entryToFile(entry)
        if (file) results.push({ filename: entry.name, file, relativePath: entry.name })
      } else if (entry.isDirectory) {
        // 传入根目录名作为 prefix，让子文件有相对路径
        const dirFiles = await this._readDirRecursive(entry, entry.name + '/')
        results.push(...dirFiles)
      }
    }

    return results
  }

  /**
   * 递归读取目录，返回所有文件（保留相对路径）。
   * @param {FileSystemDirectoryEntry} dirEntry
   * @param {string} prefix  当前目录的相对路径前缀
   * @returns {Promise<Array<{ filename: string, file: File, relativePath: string }>>}
   */
  async _readDirRecursive(dirEntry, prefix = '') {
    const results = []
    const reader = dirEntry.createReader()

    const readEntries = () =>
      new Promise((resolve) => {
        reader.readEntries((entries) => {
          resolve(entries)
        }, () => resolve([]))
      })

    let entries = await readEntries()
    while (entries.length > 0) {
      for (const entry of entries) {
        const relPath = prefix + entry.name
        if (entry.isFile) {
          const file = await this._entryToFile(entry)
          if (file) results.push({ filename: entry.name, file, relativePath: relPath })
        } else if (entry.isDirectory) {
          // 跳过 __pycache__ 等隐藏目录
          if (!entry.name.startsWith('__')) {
            const sub = await this._readDirRecursive(entry, relPath + '/')
            results.push(...sub)
          }
        }
      }
      entries = await readEntries()
    }

    return results
  }

  /**
   * 根据所有条目构建返回值：URDF 文件列表 + 完整文件映射。
   * @param {Array<{ filename: string, file: File, relativePath: string }>} entries
   * @returns {Promise<FolderDropResult>}
   */
  async _buildFolderResult(entries) {
    const urdfFiles = []
    const fileMap = new Map()

    for (const { filename, file, relativePath } of entries) {
      // 建立相对路径映射（支持 package:// 和 file:// 两种路径风格）
      fileMap.set(relativePath, file)

      // 同时支持 "package://" 风格的映射（兼容 ROS URDF）
      const altPath = 'package://' + relativePath
      fileMap.set(altPath, file)

      // 只收集 .urdf 文件（.xml 是 mujoco 格式，不参与 URDF 解析）
      const ext = this._ext(filename).toLowerCase()
      if (ext === 'urdf') {
        const text = await this._readFileText(file)
        if (text) urdfFiles.push({ filename: relativePath, text })
      }
    }

    return { urdfFiles, fileMap }
  }

  /**
   * 直接读取 File 的文本内容（不返回 { filename, text } 结构）。
   */
  _readFileText(file) {
    return new Promise((resolve) => {
      const reader = new FileReader()
      reader.onload = (e) => resolve(e.target?.result || null)
      reader.onerror = () => resolve(null)
      reader.readAsText(file)
    })
  }

  _entryToFile(entry) {
    return new Promise((resolve) => {
      entry.file(resolve, () => resolve(null))
    })
  }

  async _readFile(file) {
    return new Promise((resolve) => {
      const reader = new FileReader()
      reader.onload = (e) => {
        const text = e.target?.result
        if (typeof text !== 'string') { resolve(null); return }
        resolve({ filename: file.name, text })
      }
      reader.onerror = () => resolve(null)
      reader.readAsText(file)
    })
  }

  _ext(name) {
    const parts = name.split('.')
    return parts.length > 1 ? parts[parts.length - 1] : ''
  }
}
