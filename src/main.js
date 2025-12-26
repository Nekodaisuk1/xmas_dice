import './style.css'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import RAPIER from '@dimforge/rapier3d-compat'

// ===== UI =====
const ui = document.createElement('div')
ui.id = 'ui'
ui.innerHTML = `
  <div id="score-display">
    <div id="current-score-label">今回のスコア</div>
    <div id="current-score">0</div>
    <div id="total-display">
      <span class="total-label">TOTAL:</span>
      <span id="total">0</span>
    </div>
  </div>
  <button id="roll">RALL!!!! (R)</button>
  <div id="result-container">
    <div id="result-label">出目</div>
    <div id="result">—</div>
  </div>
  <div id="match-info">
    <div class="match-item">
      <span class="match-label">🎯 最多の目:</span>
      <span id="max-kind">-</span>
    </div>
  </div>
  <div id="breakdown">—</div>
  <div class="info-panel">
    <div class="info-title">✨ 役一覧</div>
    <div class="role-grid">
      <span class="role-item len-7">メリークリスマス</span>
      <span class="role-item len-5">クリスマス</span>
      <span class="role-item len-3">メリー</span>
      <span class="role-item len-3">マスク</span>
      <span class="role-item len-3">クスリ</span>
      <span class="role-item len-3">リース</span>
      <span class="role-item len-2">クマ</span>
      <span class="role-item len-2">リス</span>
      <span class="role-item len-2">マメ</span>
      <span class="role-item len-2">マス</span>
      <span class="role-item len-2">ママ</span>
    </div>
  </div>
`
document.body.appendChild(ui)
const btnRoll = ui.querySelector('#roll')
const currentScoreEl = ui.querySelector('#current-score')
const totalEl = ui.querySelector('#total')
const maxKindEl = ui.querySelector('#max-kind')
const resultEl = ui.querySelector('#result')
const breakdownEl = ui.querySelector('#breakdown')

// 画面中央エリア
const centerAnnounce = document.createElement('div')
centerAnnounce.id = 'center-announce'
document.body.appendChild(centerAnnounce)

// ===== スコア設定（チンチロ＋役）=====
let totalScore = 0
let streak = 0 // 役が出た連続回数（倍率）

const WORD_LIST = [
  'メリークリスマス',  // 7文字の最高役
  'クリスマス',
  'メリー',
  'マスク',
  'クスリ',
  'リース',
  'クマ',
  'リス',
  'マメ',
  'マス',
  'ママ',
]

function countChars(str) {
  /** @type {Record<string, number>} */
  const m = {}
  for (const ch of [...str]) m[ch] = (m[ch] ?? 0) + 1
  return m
}
const WORDS = WORD_LIST.map(w => ({
  word: w,
  need: countChars(w),
  len: [...w].length,
}))

function canMakeWord(gotCounts, needCounts) {
  for (const [ch, need] of Object.entries(needCounts)) {
    if ((gotCounts[ch] ?? 0) < need) return false
  }
  return true
}

function computeMaxKind(gotCounts) {
  let maxCh = '?'
  let maxCnt = 0
  for (const [ch, cnt] of Object.entries(gotCounts)) {
    if (cnt > maxCnt) { maxCnt = cnt; maxCh = ch }
  }
  return { maxCh, maxCnt }
}

/**
 * ルール
 * - 役点： base = 50 * 文字数
 * - 役が複数出たら comboMult = 1 + 0.35*(役数-1)
 * - “最多ゾロ目ボーナス”点： base = 20 * maxCnt
 * - 最多目倍率： kindMult = 1 + 0.25*(maxCnt-1)
 * - 役が出た連続 streak で streakMult = 1 + 0.25*streak(スコア爆発しないように最大8まで)
 */
function scoreRoll(chars10) {
  const got = countChars(chars10)
  const matched = WORDS.filter(w => canMakeWord(got, w.need))

  const { maxCh, maxCnt } = computeMaxKind(got)

  // 役点
  let roleBaseSum = 0
  const roleDetails = []
  for (const w of matched) {
    // メリークリスマスだけ個別設定
    const base = w.word === 'メリークリスマス' ? 600 : 50 * w.len
    roleBaseSum += base
    roleDetails.push({ word: w.word, base })
  }
  const comboMult = matched.length <= 1 ? 1 : (1 + 0.35 * (matched.length - 1))

  // メリークリスマス特別倍率
  const hasMerryChristmas = matched.some(w => w.word === 'メリークリスマス')
  const specialMult = hasMerryChristmas ? 2.0 : 1.0

  // 最多ゾロ目ボーナス点
  const kindBase = 20 * maxCnt
  const kindMult = 1 + 0.25 * Math.max(0, maxCnt - 1)

  // COMBO
  const nextStreak = matched.length > 0 ? Math.min(streak + 1, 8) : 0
  const streakMult = 1 + 0.25 * nextStreak

  const rolePoints = Math.round(roleBaseSum * comboMult * streakMult * specialMult)
  const kindPoints = Math.round(kindBase * kindMult * streakMult * specialMult)

  const totalAdd = rolePoints + kindPoints

  return {
    got, matched, roleDetails,
    maxCh, maxCnt,
    comboMult, kindMult, streakMult,
    rolePoints, kindPoints, totalAdd,
    nextStreak
  }
}

// ===== 画面中央の演出 =====
function showCenterAnnounce(scoreData) {
  const { matched, totalAdd, roleDetails, rolePoints, kindPoints, comboMult, streakMult, nextStreak } = scoreData
  
  // 文字数順にソート
  const sortedRoles = [...roleDetails].sort((a, b) => {
    const lenA = [...a.word].length
    const lenB = [...b.word].length
    return lenA - lenB
  })
  
  let currentDelay = 0
  const delayPerRole = 1200 // 各役の表示時間（ms）
  
  // 各役を1つずつ順番に表示
  sortedRoles.forEach((role, index) => {
    setTimeout(() => {
      // スケールを段階的に大きく(見切れたので終盤穏やかに)
      const scale = 1.0 + 0.35 * Math.log(index + 1) / Math.log(2)
      
      // 現在のコンボ数
      const comboCount = index + 1
      
      // メリークリスマスの特別演出
      const isMerryChristmas = role.word === 'メリークリスマス'
      const roleClass = isMerryChristmas ? 'announce-role merry-christmas' : 'announce-role'
      
      centerAnnounce.innerHTML = `
        <div class="${roleClass}" style="font-size: ${72 * scale}px">${role.word}</div>
        <div class="announce-score" style="font-size: ${96 * scale}px">${role.base}</div>
        <div class="announce-bonus combo-count" style="font-size: ${40 * scale}px">COMBO × ${comboCount}</div>
      `
      
      // アニメーションをリセット
      centerAnnounce.classList.remove('show')
      setTimeout(() => centerAnnounce.classList.add('show'), 10)
      
      // 効果音
      beep('win')
    }, currentDelay)
    
    currentDelay += delayPerRole
  })
  
  // 合計スコアを表示
  setTimeout(() => {
    // 最後の合計の表示スケール
    const finalScale = sortedRoles.length > 0 
      ? 1.0 + 0.35 * Math.log(sortedRoles.length) / Math.log(2) + 0.15
      : 1.0
    
    // コンボの情報追加
    let bonusInfo = ''
    if (sortedRoles.length > 1) {
      bonusInfo += `<div class="announce-bonus">COMBO × ${sortedRoles.length}</div>`
    }
    
    centerAnnounce.innerHTML = `
      <div class="announce-role" style="font-size: ${72 * finalScale}px">合計</div>
      <div class="announce-score total-score" style="font-size: ${120 * finalScale}px">${totalAdd}</div>
      ${bonusInfo}
    `
    
    // アニメーションをリセット
    centerAnnounce.classList.remove('show')
    setTimeout(() => centerAnnounce.classList.add('show'), 10)
    
    beep('win')
  }, currentDelay)
  
  currentDelay += 2000
  
  // 全て終わったらフェードアウト
  setTimeout(() => {
    centerAnnounce.classList.remove('show')
  }, currentDelay)
}

// ===== サウンド(適当) =====
let audioCtx = null
function beep(type='click') {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)()
  const t0 = audioCtx.currentTime

  if (type === 'win') {
    const freqs = [523, 659, 784, 1046, 1318, 1568, 2093, 2637] // C5-E7の和音
    freqs.forEach((freq, i) => {
      const o = audioCtx.createOscillator()
      const g = audioCtx.createGain()
      
      o.type = 'triangle'
      o.frequency.setValueAtTime(freq, t0)
      
      const delay = i * 0.015
      const startTime = t0 + delay
      const dur = 0.25
      
      g.gain.setValueAtTime(0.0001, startTime)
      g.gain.exponentialRampToValueAtTime(0.3, startTime + 0.005)
      g.gain.exponentialRampToValueAtTime(0.0001, startTime + dur)
      
      o.connect(g).connect(audioCtx.destination)
      o.start(startTime)
      o.stop(startTime + dur)
    })
    
    const bass = audioCtx.createOscillator()
    const bassGain = audioCtx.createGain()
    bass.type = 'sine'
    bass.frequency.setValueAtTime(130, t0)
    bassGain.gain.setValueAtTime(0.0001, t0)
    bassGain.gain.exponentialRampToValueAtTime(0.2, t0 + 0.01)
    bassGain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.3)
    bass.connect(bassGain).connect(audioCtx.destination)
    bass.start(t0)
    bass.stop(t0 + 0.3)
    
  } else if (type === 'roll') {
    const o = audioCtx.createOscillator()
    const g = audioCtx.createGain()
    
    o.type = 'square'
    o.frequency.setValueAtTime(180, t0)
    
    g.gain.setValueAtTime(0.0001, t0)
    g.gain.exponentialRampToValueAtTime(0.12, t0 + 0.01)
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.1)
    
    o.connect(g).connect(audioCtx.destination)
    o.start(t0)
    o.stop(t0 + 0.1)
    
  } else if (type === 'settle') {
    const o = audioCtx.createOscillator()
    const g = audioCtx.createGain()
    
    o.type = 'sine'
    o.frequency.setValueAtTime(640, t0)
    
    g.gain.setValueAtTime(0.0001, t0)
    g.gain.exponentialRampToValueAtTime(0.15, t0 + 0.005)
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.08)
    
    o.connect(g).connect(audioCtx.destination)
    o.start(t0)
    o.stop(t0 + 0.08)
    
  } else {
    const o = audioCtx.createOscillator()
    const g = audioCtx.createGain()
    
    o.type = 'sine'
    o.frequency.setValueAtTime(420, t0)
    
    g.gain.setValueAtTime(0.0001, t0)
    g.gain.exponentialRampToValueAtTime(0.14, t0 + 0.01)
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.14)
    
    o.connect(g).connect(audioCtx.destination)
    o.start(t0)
    o.stop(t0 + 0.14)
  }
}

// ===== Three.js =====
const scene = new THREE.Scene()

// 背景
const backgroundGradient = (() => {
  const canvas = document.createElement('canvas')
  canvas.width = 2
  canvas.height = 512
  const ctx = canvas.getContext('2d')
  
  const gradient = ctx.createLinearGradient(0, 0, 0, 512)
  gradient.addColorStop(0, '#1a1f3a')    // 深い夜空
  gradient.addColorStop(0.3, '#2d4263')  // 夜明け前
  gradient.addColorStop(0.5, '#5a7fa8')  // 明け方の空
  gradient.addColorStop(0.7, '#a8c5e2')  // 朝の空
  gradient.addColorStop(1, '#e8f4f8')    // 明るい空
  
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, 2, 512)
  
  const texture = new THREE.CanvasTexture(canvas)
  texture.minFilter = THREE.LinearFilter
  texture.magFilter = THREE.LinearFilter
  
  return texture
})()

scene.background = backgroundGradient

const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.1, 200)
camera.position.set(8, 10, 14)
camera.lookAt(0, 0, 0)

const renderer = new THREE.WebGLRenderer({ antialias: true })
renderer.setSize(innerWidth, innerHeight)
renderer.setPixelRatio(devicePixelRatio)
renderer.shadowMap.enabled = true
document.body.appendChild(renderer.domElement)

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(innerWidth, innerHeight)
})

// Light
scene.add(new THREE.AmbientLight(0xffffff, 0.7))
const dir = new THREE.DirectionalLight(0xffffff, 1.0)
dir.position.set(10, 20, 10)
dir.castShadow = true
dir.shadow.mapSize.set(2048, 2048)
scene.add(dir)

// ===== 雪 =====
function createSnow({ count = 2400, area = 22, yMin = 0, yMax = 18 } = {}) {
  const geo = new THREE.BufferGeometry()
  const positions = new Float32Array(count * 3)
  const speeds = new Float32Array(count)

  for (let i = 0; i < count; i++) {
    const x = (Math.random() - 0.5) * area
    const y = yMin + Math.random() * (yMax - yMin)
    const z = (Math.random() - 0.5) * area
    positions[i * 3 + 0] = x
    positions[i * 3 + 1] = y
    positions[i * 3 + 2] = z
    speeds[i] = 0.6 + Math.random() * 1.4
  }
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  const mat = new THREE.PointsMaterial({
    size: 0.06,
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
  })
  const points = new THREE.Points(geo, mat)
  scene.add(points)

  return {
    points, positions, speeds, area, yMin, yMax,
    windBoost: 1.0,
    update(dt) {
      const wind = Math.sin(performance.now() * 0.0003) * 0.3 * this.windBoost
      for (let i = 0; i < count; i++) {
        const idx = i * 3
        positions[idx + 0] += wind * dt * 0.2
        positions[idx + 2] += Math.cos((i + performance.now() * 0.001) * 0.02) * dt * 0.02
        positions[idx + 1] -= speeds[i] * dt

        if (positions[idx + 1] < yMin) {
          positions[idx + 1] = yMax
          positions[idx + 0] = (Math.random() - 0.5) * area
          positions[idx + 2] = (Math.random() - 0.5) * area
          speeds[i] = 0.6 + Math.random() * 1.4
        }
        if (positions[idx + 0] < -area / 2) positions[idx + 0] += area
        if (positions[idx + 0] >  area / 2) positions[idx + 0] -= area
        if (positions[idx + 2] < -area / 2) positions[idx + 2] += area
        if (positions[idx + 2] >  area / 2) positions[idx + 2] -= area
      }
      points.geometry.attributes.position.needsUpdate = true
    }
  }
}
const snow = createSnow()

// ===== コンフェッティ =====
function createConfettiSystem(max = 2500) {
  const geo = new THREE.BufferGeometry()
  const positions = new Float32Array(max * 3)
  const colors = new Float32Array(max * 3)
  const velocities = new Float32Array(max * 3)
  const life = new Float32Array(max)
  let alive = 0

  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))

  const mat = new THREE.PointsMaterial({
    size: 0.08,
    transparent: true,
    opacity: 1.0,
    depthWrite: false,
    vertexColors: true,
  })

  const points = new THREE.Points(geo, mat)
  scene.add(points)

  function spawnBurst({ n = 500, x = 0, y = 8, z = 0, spread = 6, power = 8 } = {}) {
    for (let i = 0; i < n; i++) {
      const id = alive % max
      alive++

      const idx = id * 3
      positions[idx + 0] = x + (Math.random() - 0.5) * 0.5
      positions[idx + 1] = y + (Math.random() - 0.5) * 0.5
      positions[idx + 2] = z + (Math.random() - 0.5) * 0.5

      // 色（ほどよく派手）
      const r = 0.4 + Math.random() * 0.6
      const g = 0.4 + Math.random() * 0.6
      const b = 0.4 + Math.random() * 0.6
      colors[idx + 0] = r
      colors[idx + 1] = g
      colors[idx + 2] = b

      velocities[idx + 0] = (Math.random() - 0.5) * spread
      velocities[idx + 1] = power * (0.7 + Math.random() * 0.6)
      velocities[idx + 2] = (Math.random() - 0.5) * spread

      life[id] = 1.3 + Math.random() * 0.9
    }
    geo.attributes.position.needsUpdate = true
    geo.attributes.color.needsUpdate = true
  }

  function update(dt) {
    const gravity = 11.0
    const start = Math.max(0, alive - max)
    const end = alive
    for (let a = start; a < end; a++) {
      const id = a % max
      if (life[id] <= 0) continue
      const idx = id * 3

      velocities[idx + 1] -= gravity * dt
      positions[idx + 0] += velocities[idx + 0] * dt
      positions[idx + 1] += velocities[idx + 1] * dt
      positions[idx + 2] += velocities[idx + 2] * dt

      life[id] -= dt
      // フェードはopacityを毎粒でやると重いので、寿命0で消える方式
      if (life[id] <= 0) {
        positions[idx + 1] = -9999
      }
    }
    geo.attributes.position.needsUpdate = true
  }

  return { points, spawnBurst, update }
}
const confetti = createConfettiSystem()

let world
const dice = [] // { mesh, body }
let diceTemplate = null
let diceSize = 1
let settledFrames = 0

// 目の文字と法線ベクトル
// +X リ / -X ー / +Y ク / -Y ス / +Z マ / -Z メ
const FACE_CHARS = [
  { n: new THREE.Vector3( 1, 0, 0), ch: 'リ' },
  { n: new THREE.Vector3(-1, 0, 0), ch: 'ー' },
  { n: new THREE.Vector3( 0, 1, 0), ch: 'ク' },
  { n: new THREE.Vector3( 0,-1, 0), ch: 'ス' },
  { n: new THREE.Vector3( 0, 0, 1), ch: 'マ' },
  { n: new THREE.Vector3( 0, 0,-1), ch: 'メ' },
]

function getTopChar(obj3d) {
  const up = new THREE.Vector3(0, 1, 0)
  let best = { ch: '?', dot: -Infinity }
  for (const f of FACE_CHARS) {
    const w = f.n.clone().applyQuaternion(obj3d.quaternion)
    const d = w.dot(up)
    if (d > best.dot) best = { ch: f.ch, dot: d }
  }
  return best.ch
}

function clearDice() {
  for (const d of dice) {
    world.removeRigidBody(d.body)
    scene.remove(d.mesh)
  }
  dice.length = 0
}

function setupBounds() {
  const floorTexture = (() => {
    const canvas = document.createElement('canvas')
    canvas.width = 512
    canvas.height = 512
    const ctx = canvas.getContext('2d')
    
    const gridSize = 8
    const cellSize = canvas.width / gridSize
    
    for (let y = 0; y < gridSize; y++) {
      for (let x = 0; x < gridSize; x++) {
        const isEven = (x + y) % 2 === 0
        ctx.fillStyle = isEven ? '#c41e3a' : '#165b33' // クリスマスレッド & グリーン
        ctx.fillRect(x * cellSize, y * cellSize, cellSize, cellSize)
      }
    }
    
    const texture = new THREE.CanvasTexture(canvas)
    texture.wrapS = THREE.RepeatWrapping
    texture.wrapT = THREE.RepeatWrapping
    texture.repeat.set(4, 4)
    
    return texture
  })()
  
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(20, 20),
    new THREE.MeshStandardMaterial({ 
      map: floorTexture,
      roughness: 0.85,
      metalness: 0.1,
      transparent: true,
      opacity: 0.0
    })
  )
  floor.rotation.x = -Math.PI / 2
  floor.receiveShadow = true
  scene.add(floor)

  // floor collider
  const floorBody = world.createRigidBody(RAPIER.RigidBodyDesc.fixed())
  world.createCollider(RAPIER.ColliderDesc.cuboid(10, 0.1, 10).setTranslation(0, -0.1, 0), floorBody)

  // walls
  const wallBody = world.createRigidBody(RAPIER.RigidBodyDesc.fixed())
  const h = 12, t = 0.5, w = 10
  world.createCollider(RAPIER.ColliderDesc.cuboid(w, h, t).setTranslation(0, h, 10), wallBody)
  world.createCollider(RAPIER.ColliderDesc.cuboid(w, h, t).setTranslation(0, h, -10), wallBody)
  world.createCollider(RAPIER.ColliderDesc.cuboid(t, h, w).setTranslation(10, h, 0), wallBody)
  world.createCollider(RAPIER.ColliderDesc.cuboid(t, h, w).setTranslation(-10, h, 0), wallBody)
}

async function loadDiceGLB() {
  const loader = new GLTFLoader()
  const gltf = await loader.loadAsync('./xmas_dice.glb')
  diceTemplate = gltf.scene

  // サイズ計測
  const box = new THREE.Box3().setFromObject(diceTemplate)
  const size = new THREE.Vector3()
  box.getSize(size)
  diceSize = Math.max(size.x, size.y, size.z)
}

function spawnDice10() {
  if (!diceTemplate) return

  beep('roll')
  clearDice()
  currentScoreEl.textContent = '0'
  resultEl.textContent = '—'
  breakdownEl.textContent = '—'
  maxKindEl.textContent = '-'
  settledFrames = 0

  // 雪を少し強める
  snow.windBoost = 1.6
  setTimeout(() => (snow.windBoost = 1.0), 500)

  for (let i = 0; i < 10; i++) {
    const mesh = diceTemplate.clone(true)
    mesh.traverse(o => {
      if (o.isMesh) {
        o.castShadow = true
        o.receiveShadow = true
      }
    })
    scene.add(mesh)

    const x = (Math.random() - 0.5) * 4
    const y = 8 + Math.random() * 4
    const z = (Math.random() - 0.5) * 4

    const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(x, y, z)
      .setLinearDamping(0.25)
      .setAngularDamping(0.25)
      .setCcdEnabled(true)

    bodyDesc.setRotation({ x: Math.random(), y: Math.random(), z: Math.random(), w: Math.random() })

    const body = world.createRigidBody(bodyDesc)

    const half = diceSize * 0.5
    const col = RAPIER.ColliderDesc.cuboid(half, half, half)
      .setRestitution(0.35)
      .setFriction(0.9)
    world.createCollider(col, body)

    body.applyImpulse({ x:(Math.random()-0.5)*1.5, y:0, z:(Math.random()-0.5)*1.5 }, true)
    body.applyTorqueImpulse({ x:(Math.random()-0.5)*1.5, y:(Math.random()-0.5)*1.5, z:(Math.random()-0.5)*1.5 }, true)

    dice.push({ mesh, body })
  }
}

// ===== 起動 =====
async function main() {
  await RAPIER.init()
  world = new RAPIER.World({ x: 0, y: -19.62, z: 0 })

  setupBounds()
  await loadDiceGLB()
  spawnDice10()

  btnRoll.addEventListener('click', spawnDice10)
  addEventListener('keydown', (e) => {
    if (e.key.toLowerCase() === 'r') spawnDice10()
  })

  let last = performance.now()

  function tick() {
    const now = performance.now()
    const dt = Math.min(0.033, (now - last) / 1000)
    last = now

    snow.update(dt)
    confetti.update(dt)

    world.step()

    // 物理 → 描画
    for (const d of dice) {
      const t = d.body.translation()
      const r = d.body.rotation()
      d.mesh.position.set(t.x, t.y, t.z)
      d.mesh.quaternion.set(r.x, r.y, r.z, r.w)
    }

    // 全部止まったら確定
    if (dice.length > 0) {
      const allSleep = dice.every(d => d.body.isSleeping())
      settledFrames = allSleep ? settledFrames + 1 : 0

      if (settledFrames === 12) {
        beep('settle')

        const chars = dice.map(d => getTopChar(d.mesh)).join('')
        resultEl.textContent = chars

        const s = scoreRoll(chars)

        // streak更新
        streak = s.nextStreak

        // 演出の総時間を計算
        const delayPerRole = 1200
        const totalDelay = s.matched.length > 0 
          ? (s.matched.length * delayPerRole) + 2000  // 役の表示 + 合計表示
          : 0

        if (s.matched.length > 0) {
          beep('win')
          confetti.spawnBurst({ n: 1500 + 300 * Math.min(4, s.matched.length), y: 9, power: 12 })
          setTimeout(() => confetti.spawnBurst({ n: 800, y: 8, power: 10 }), 150)
          setTimeout(() => confetti.spawnBurst({ n: 600, y: 9.5, power: 11 }), 300)
          snow.windBoost = 4.5
          setTimeout(() => (snow.windBoost = 1.0), 1200)
          
          // 画面中央に演出を表示
          showCenterAnnounce(s)
          
          // 演出が終わってから左のUIを更新
          setTimeout(() => {
            currentScoreEl.textContent = s.totalAdd.toLocaleString()
            totalScore += s.totalAdd
            totalEl.textContent = totalScore.toLocaleString()
            maxKindEl.textContent = `${s.maxCh} × ${s.maxCnt}`
            
            const roleBadges = s.roleDetails.length
              ? s.roleDetails.map(r => `<span class="badge">${r.word} ${r.base}</span>`).join('')
              : `<span class="badge">役なし</span>`

            breakdownEl.innerHTML = `
              <div>${roleBadges}</div>
              <div style="margin-top:6px">
                <span class="badge">最多: ${s.maxCh} × ${s.maxCnt}</span>
                <span class="badge">combo×${s.comboMult.toFixed(2)}</span>
                <span class="badge">kind×${s.kindMult.toFixed(2)}</span>
              </div>
              <div style="margin-top:6px">
                <b>${s.totalAdd}</b>
                <span class="badge">役点:${s.rolePoints}</span>
                <span class="badge">最多点:${s.kindPoints}</span>
              </div>
            `
          }, totalDelay)
        } else {
          currentScoreEl.textContent = s.totalAdd.toLocaleString()
          totalScore += s.totalAdd
          totalEl.textContent = totalScore.toLocaleString()
          maxKindEl.textContent = `${s.maxCh} × ${s.maxCnt}`
          
          if (s.maxCnt >= 5) {
            confetti.spawnBurst({ n: 450, y: 8.5, power: 8 })
          }
                    npm run dev
          const roleBadges = s.roleDetails.length
            ? s.roleDetails.map(r => `<span class="badge">${r.word} ${r.base}</span>`).join('')
            : `<span class="badge">役なし</span>`

          breakdownEl.innerHTML = `
            <div>${roleBadges}</div>
            <div style="margin-top:6px">
              <span class="badge">最多: ${s.maxCh} × ${s.maxCnt}</span>
              <span class="badge">combo×${s.comboMult.toFixed(2)}</span>
              <span class="badge">kind×${s.kindMult.toFixed(2)}</span>
            </div>
            <div style="margin-top:6px">
              <b>${s.totalAdd}</b>
              <span class="badge">役点:${s.rolePoints}</span>
              <span class="badge">最多点:${s.kindPoints}</span>
            </div>
          `
        }
      }
    }

    renderer.render(scene, camera)
    requestAnimationFrame(tick)
  }
  tick()
}

main()
