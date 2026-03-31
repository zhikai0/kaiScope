import * as THREE from 'three'

/**
 * BaseMarker — 所有 Marker 的基类
 *
 * 设计原则：
 *  - 每个子类有固定的 static TYPE（字符串）和 static ROS_MSG_TYPE（ROS 消息类型数组）
 *  - 构造时会校验传入的 rosMsgType 是否匹配，不匹配则抛出错误
 *  - 创建成功后调用 update(data) 传入 ROS 消息数据驱动渲染
 *  - 调用 addToScene(scene) / removeFromScene(scene) 管理生命周期
 *
 * 子类必须实现：
 *  - static get TYPE()           返回 marker 类型字符串，如 'axes'
 *  - static get ROS_MSG_TYPES()  返回支持的 ROS 消息类型数组
 *  - _build()                    构建 Three.js 对象，挂到 this.root
 *  - update(data)                接收 ROS 消息数据，更新场景对象
 */
export class BaseMarker {
  /**
   * @param {string} rosMsgType  调用方传入的 ROS 消息类型，必须在子类 ROS_MSG_TYPES 列表内
   * @param {object} options     可选初始化参数（scale, color 等）
   */
  constructor(rosMsgType, options = {}) {
    const cls = this.constructor

    // 校验 type 是否定义
    if (!cls.TYPE) {
      throw new Error(`[BaseMarker] 子类 ${cls.name} 必须定义 static get TYPE()`)
    }
    // 校验 ROS 消息类型
    if (!cls.ROS_MSG_TYPES || !cls.ROS_MSG_TYPES.includes(rosMsgType)) {
      throw new Error(
        `[${cls.TYPE}Marker] 不支持的 ROS 消息类型 "${rosMsgType}"。\n` +
        `支持的类型：${(cls.ROS_MSG_TYPES || []).join(', ')}`
      )
    }

    this.type       = cls.TYPE
    this.rosMsgType = rosMsgType
    this.options    = options
    this.visible    = true

    // Three.js 根节点，所有子对象挂在这里
    this.root = new THREE.Group()
    this.root.name = `marker_${cls.TYPE}`

    // 构建场景对象（子类实现）
    this._build()
  }

  // ── 子类必须重写 ────────────────────────────────────────────────────

  /** 构建 Three.js 对象，挂到 this.root */
  _build() {
    throw new Error(`[${this.type}Marker] 必须实现 _build()`)
  }

  /**
   * 接收 ROS 消息数据，更新场景对象
   * @param {object} data  ROS 消息对象
   */
  update(data) {
    throw new Error(`[${this.type}Marker] 必须实现 update(data)`)
  }

  // ── 通用方法 ────────────────────────────────────────────────────────

  /** 挂载到场景 */
  addToScene(scene) {
    if (!scene) return
    if (!scene.children.includes(this.root)) scene.add(this.root)
  }

  /** 从场景移除 */
  removeFromScene(scene) {
    if (!scene) return
    scene.remove(this.root)
  }

  /** 设置显示/隐藏 */
  setVisible(v) {
    this.visible = v
    this.root.visible = v
  }

  /** 释放 GPU 资源，移除前调用 */
  dispose() {
    this.root.traverse(obj => {
      if (obj.geometry) obj.geometry.dispose()
      if (obj.material) {
        if (Array.isArray(obj.material)) obj.material.forEach(m => m.dispose())
        else obj.material.dispose()
      }
    })
  }
}
