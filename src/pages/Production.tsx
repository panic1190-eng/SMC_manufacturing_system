import { useRef, useState } from 'react'
import { Badge, Card, Field, Notice, Num } from '../ui'
import { update, uid, useDB } from '../store'
import { fmt, matLabel, matOf, nextLotNo, recipeName, today } from '../util'
import { glassFraction, scaleRecipe } from '../engine/calc'
import type { DB, ProductionRun, Roll } from '../types'

const VISC_LABELS = ['초기', '5분', '10분', '15분', '20분', '25분']
const PRESHIP: [string, string, string][] = [
  ['edge', '시트 가장자리', 'R/V 돌출 및 커팅 불량 없을 것'],
  ['tack', '시트 점착성', '필름을 벗길 때 너무 끈적거리지 않은가'],
  ['impreg', '표면 함침 상태', '육안상 함침이 미비한 곳이 없는가'],
  ['foreign', '이물질 혼입', '금속 및 기타 이물질 혼입 여부'],
  ['pack', '포장', '포장 상태는 양호한가'],
]

interface ScannedRunData {
  tempC?: number
  humidity?: number
  weather?: string
  workers?: number
  downtime?: string
  matLots?: Record<string, string>
  actualUse?: Record<string, number>
  viscosity?: { label: string; ps: number; tempC: number }[]
  dischargeMeasured?: { compound: number; mgo: number; color: number }
  rolls?: Partial<Roll>[]
  glassLots?: string
  glassRollKg?: number
  sampleGfPct?: number
  preShip?: Record<string, 'ok' | 'ng' | ''>
  notes?: string
}

/** 이미지를 적절한 해상도(최대 1600px)의 JPEG Data URL로 변환 */
function fileToScanImage(file: File, maxDim = 1600): Promise<{ dataUrl: string; base64: string; mime: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('이미지 파일을 읽을 수 없습니다.'))
    reader.onload = () => {
      const src = reader.result as string
      const img = new Image()
      img.onerror = () => reject(new Error('올바른 이미지 파일이 아닙니다.'))
      img.onload = () => {
        let w = img.width
        let h = img.height
        if (w > maxDim || h > maxDim) {
          const r = Math.min(maxDim / w, maxDim / h)
          w = Math.round(w * r)
          h = Math.round(h * r)
        }
        const canvas = document.createElement('canvas')
        canvas.width = w
        canvas.height = h
        const ctx = canvas.getContext('2d')
        if (!ctx) {
          const comma = src.indexOf(',')
          resolve({ dataUrl: src, base64: src.slice(comma + 1), mime: file.type || 'image/jpeg' })
          return
        }
        ctx.drawImage(img, 0, 0, w, h)
        const outUrl = canvas.toDataURL('image/jpeg', 0.88)
        const comma = outUrl.indexOf(',')
        resolve({ dataUrl: outUrl, base64: outUrl.slice(comma + 1), mime: 'image/jpeg' })
      }
      img.src = src
    }
    reader.readAsDataURL(file)
  })
}

async function runVisionOCR(
  db: DB,
  run: ProductionRun,
  img: { base64: string; mime: string; dataUrl: string },
): Promise<ScannedRunData> {
  const key = db.settings.ocrApiKey.trim()
  if (!key) throw new Error('AI API Key가 설정되지 않았습니다. 아래 입력란에 API Key를 입력하거나 「샘플 스캔 시연」을 눌러보세요.')

  const mix = db.mixOrders.find((m) => m.id === run.mixOrderId)
  const matList = (mix?.lines ?? []).map((l) => {
    const m = matOf(db, l.materialId)
    return { materialId: l.materialId, name: m?.name ?? '', grade: m?.grade ?? '', planKg: l.planKg }
  })

  const prompt = `당신은 SMC 제조 현장의 수기 'SMC 일일 생산일지' 사진을 판독하는 전문 OCR AI입니다.
사진에 적힌 수기 숫자와 텍스트를 읽어서 아래 JSON 형식으로만 응답하세요(마크다운 코드블록 없이 순수 JSON만 반환).
원재료 목록(materialId 매핑용): ${JSON.stringify(matList)}

반환할 JSON 스키마:
{
  "tempC": 숫자(온도 ℃, 없으면 0),
  "humidity": 숫자(습도 %, 없으면 0),
  "weather": "맑음" | "흐림" | "비" | "눈",
  "workers": 숫자(작업인원, 기본 6),
  "downtime": 문자열(비가동/청소 내역),
  "matLots": { "[materialId]": "원재료 Lot 문자열" },
  "actualUse": { "[materialId]": 숫자(실사용량 kg) },
  "viscosity": [
    { "label": "초기", "ps": 숫자, "tempC": 숫자 },
    { "label": "5분", "ps": 숫자, "tempC": 숫자 },
    { "label": "10분", "ps": 숫자, "tempC": 숫자 },
    { "label": "15분", "ps": 숫자, "tempC": 숫자 },
    { "label": "20분", "ps": 숫자, "tempC": 숫자 },
    { "label": "25분", "ps": 숫자, "tempC": 숫자 }
  ],
  "dischargeMeasured": { "compound": 숫자(kg/min), "mgo": 숫자(g/min), "color": 숫자(g/min) },
  "rolls": [
    {
      "widthMm": 숫자, "speed": 숫자, "db1": 숫자, "db2": 숫자,
      "cut1": 숫자, "cut2": 숫자, "arealKgM2": 숫자, "thicknessMm": 숫자,
      "impregPct": 숫자, "grossKg": 숫자, "netKg": 숫자, "finalVisc": 숫자, "note": "문자열"
    }
  ],
  "glassLots": "유리섬유 Lot 문자열",
  "glassRollKg": 숫자(유리섬유 전체 사용량 kg),
  "sampleGfPct": 숫자(실측 유리섬유 함량 %),
  "preShip": { "edge": "ok"|"ng", "tack": "ok"|"ng", "impreg": "ok"|"ng", "foreign": "ok"|"ng", "pack": "ok"|"ng" },
  "notes": "특이사항 문자열"
}`

  let rawText = ''
  if (db.settings.ocrProvider === 'openai') {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              { type: 'image_url', image_url: { url: img.dataUrl } },
            ],
          },
        ],
      }),
    })
    if (!res.ok) throw new Error(`OpenAI API 오류 (${res.status}): ${await res.text()}`)
    const data = await res.json()
    rawText = data.choices?.[0]?.message?.content ?? '{}'
  } else {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(key)}`
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { text: prompt },
              { inline_data: { mime_type: img.mime, data: img.base64 } },
            ],
          },
        ],
        generationConfig: { responseMimeType: 'application/json' },
      }),
    })
    if (!res.ok) throw new Error(`Gemini API 오류 (${res.status}): ${await res.text()}`)
    const data = await res.json()
    rawText = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '{}'
  }

  const cleaned = rawText.replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim()
  return JSON.parse(cleaned) as ScannedRunData
}

/** 실제 현장 엑셀(GRP_작업일지_개선_v6_1.xlsx) 데이터를 기반으로 한 샘플 스캔 추출 데이터 생성 */
function buildDemoScanData(db: DB, run: ProductionRun): ScannedRunData {
  const mix = db.mixOrders.find((m) => m.id === run.mixOrderId)
  const st = db.settingRuns.find((s) => s.id === run.settingRunId)
  const w = st?.input.widthMm ?? (run.targetWidthMm || 1100)
  const spd = st?.input.speed ?? 10
  const dbGap = st ? Number(st.output.boxGapMm.toFixed(2)) : 1.65
  const cutRpm = st ? Number((st.output.cutterRpm[0] ?? 59.4).toFixed(1)) : 59.4
  const targetAreal = run.targetArealKgM2 || 4.6

  const actualUse: Record<string, number> = {}
  const matLots: Record<string, string> = {}
  const dateTag = run.date.replace(/-/g, '').slice(2)
  for (const [idx, l] of (mix?.lines ?? []).entries()) {
    const m = matOf(db, l.materialId)
    actualUse[l.materialId] = Number(l.planKg.toFixed(2))
    matLots[l.materialId] = `${m?.grade.replace(/[^A-Z0-9]/gi, '').slice(0, 5) || 'LOT'}-${dateTag}${String(idx + 1).padStart(2, '0')}`
  }

  return {
    tempC: 25.5,
    humidity: 52,
    weather: '맑음',
    workers: 6,
    downtime: '작업 전 D/B 갭 점검 및 커터 청소 (15분)',
    matLots,
    actualUse,
    viscosity: [
      { label: '초기', ps: 125, tempC: 34 },
      { label: '5분', ps: 145, tempC: 33.5 },
      { label: '10분', ps: 210, tempC: 33 },
      { label: '15분', ps: 380, tempC: 33 },
      { label: '20분', ps: 510, tempC: 32.5 },
      { label: '25분', ps: 640, tempC: 32 },
    ],
    dischargeMeasured: {
      compound: st ? Number((st.output.pumpA * 0.998).toFixed(3)) : 33.11,
      mgo: st ? Number((st.output.pumpMgO * 1.002).toFixed(1)) : 325.6,
      color: st ? Number((st.output.pumpColor * 0.999).toFixed(1)) : 465.1,
    },
    rolls: [
      { widthMm: w, speed: spd, db1: dbGap, db2: dbGap, cut1: cutRpm, cut2: cutRpm, arealKgM2: targetAreal, thicknessMm: 3.0, impregPct: 98, grossKg: 580, netKg: 552, finalVisc: 450, note: '양호' },
      { widthMm: w, speed: spd, db1: dbGap, db2: dbGap, cut1: cutRpm, cut2: cutRpm, arealKgM2: Number((targetAreal + 0.03).toFixed(2)), thicknessMm: 3.0, impregPct: 98, grossKg: 576, netKg: 548, finalVisc: 455, note: '양호' },
      { widthMm: w, speed: spd, db1: dbGap, db2: dbGap, cut1: cutRpm, cut2: cutRpm, arealKgM2: Number((targetAreal - 0.02).toFixed(2)), thicknessMm: 3.0, impregPct: 99, grossKg: 582, netKg: 554, finalVisc: 460, note: '양호' },
      { widthMm: w, speed: spd, db1: dbGap, db2: dbGap, cut1: cutRpm, cut2: cutRpm, arealKgM2: targetAreal, thicknessMm: 3.0, impregPct: 98, grossKg: 575, netKg: 547, finalVisc: 450, note: '양호' },
    ],
    glassLots: 'CPIC-4800T-2610A',
    glassRollKg: 718,
    sampleGfPct: 33.1,
    preShip: { edge: 'ok', tack: 'ok', impreg: 'ok', foreign: 'ok', pack: 'ok' },
    notes: '수기 생산일지 스캔 자동 입력 완료 (특이사항 없음)',
  }
}

export default function Production() {
  const db = useDB()
  const [openId, setOpenId] = useState('')
  const [mixId, setMixId] = useState(db.mixOrders[0]?.id ?? '')
  const [settingId, setSettingId] = useState('')
  const [date, setDate] = useState(today())
  const [sampleTotal, setSampleTotal] = useState(0)
  const [samplePaste, setSamplePaste] = useState(0)

  // 인쇄 모드: '' | 'blank' (빈 양식) | 'filled' (작성된 일지)
  const [printMode, setPrintMode] = useState<'' | 'blank' | 'filled'>('')

  // 사진 촬영 / 스캔 입력 상태
  const [scanOpen, setScanOpen] = useState(false)
  const [scanImg, setScanImg] = useState<{ dataUrl: string; base64: string; mime: string } | null>(null)
  const [scanZoom, setScanZoom] = useState(100)
  const [scanRot, setScanRot] = useState(0)
  const [scanBusy, setScanBusy] = useState(false)
  const [scanError, setScanError] = useState('')
  const [scanned, setScanned] = useState<ScannedRunData | null>(null)
  const scanFileRef = useRef<HTMLInputElement>(null)
  const cameraFileRef = useRef<HTMLInputElement>(null)

  const run = db.runs.find((r) => r.id === openId)
  const noUser = !db.user.trim()

  const create = (openScanAfter = false) => {
    const mix = db.mixOrders.find((m) => m.id === mixId)
    if (!mix) return
    const recipe = db.recipes.find((r) => r.id === mix.recipeId)
    const product = db.products.find((p) => p.id === recipe?.productId)
    const st = db.settingRuns.find((s) => s.id === settingId)
    const r: ProductionRun = {
      id: uid('g'), date, productCode: product?.code ?? '', lotNo: nextLotNo(db, date), mixOrderId: mix.id, settingRunId: settingId,
      tempC: 0, humidity: 0, weather: '맑음', workers: 6, downtime: '', rolls: [],
      matLots: {}, actualUse: Object.fromEntries(mix.lines.map((l) => [l.materialId, l.actualKg ?? l.planKg])),
      viscosity: VISC_LABELS.map((label) => ({ label, ps: 0, tempC: 0 })),
      dischargeMeasured: { compound: 0, mgo: 0, color: 0 }, glassLots: '', glassRollKg: 0,
      preShip: {}, targetArealKgM2: st?.input.arealKgM2 ?? product?.arealKgM2 ?? 0, targetWidthMm: st?.input.widthMm ?? product?.widthMm ?? 0,
      targetThicknessMm: 0, notes: '', status: 'open',
    }
    update((d) => ({ ...d, runs: [r, ...d.runs] }), { action: '생산일지 작성', detail: `${r.lotNo} ${mix.no}` })
    setOpenId(r.id)
    if (openScanAfter) {
      setScanOpen(true)
      setScanned(null)
      setScanError('')
    }
  }

  const patch = (id: string, fn: (r: ProductionRun) => ProductionRun, audit?: { action: string; detail: string }) =>
    update((d) => ({ ...d, runs: d.runs.map((r) => (r.id === id ? fn(r) : r)) }), audit)

  const mixRecipeIds = (mixIdv: string) => db.mixOrders.find((m) => m.id === mixIdv)?.recipeId
  const settingsForMix = db.settingRuns.filter((s) => s.recipeId === mixRecipeIds(mixId))

  const triggerPrint = (mode: 'blank' | 'filled') => {
    setPrintMode(mode)
    setTimeout(() => {
      window.print()
    }, 80)
  }

  const applyScannedData = (targetRun: ProductionRun, data: ScannedRunData) => {
    const st = db.settingRuns.find((s) => s.id === targetRun.settingRunId)
    patch(
      targetRun.id,
      (r) => ({
        ...r,
        tempC: data.tempC ?? r.tempC,
        humidity: data.humidity ?? r.humidity,
        weather: data.weather || r.weather,
        workers: data.workers ?? r.workers,
        downtime: data.downtime ?? r.downtime,
        matLots: { ...r.matLots, ...(data.matLots ?? {}) },
        actualUse: { ...r.actualUse, ...(data.actualUse ?? {}) },
        viscosity: data.viscosity && data.viscosity.length === 6 ? data.viscosity : r.viscosity,
        dischargeMeasured: {
          compound: data.dischargeMeasured?.compound ?? r.dischargeMeasured.compound,
          mgo: data.dischargeMeasured?.mgo ?? r.dischargeMeasured.mgo,
          color: data.dischargeMeasured?.color ?? r.dischargeMeasured.color,
        },
        rolls:
          data.rolls && data.rolls.length > 0
            ? data.rolls.map((x) => ({
                widthMm: x.widthMm ?? st?.input.widthMm ?? r.targetWidthMm,
                speed: x.speed ?? st?.input.speed ?? 10,
                db1: x.db1 ?? (st ? Number(st.output.boxGapMm.toFixed(3)) : 0),
                db2: x.db2 ?? (st ? Number(st.output.boxGapMm.toFixed(3)) : 0),
                cut1: x.cut1 ?? Number((st?.output.cutterRpm[0] ?? 0).toFixed(1)),
                cut2: x.cut2 ?? Number((st?.output.cutterRpm[1] ?? 0).toFixed(1)),
                arealKgM2: x.arealKgM2 ?? 0,
                thicknessMm: x.thicknessMm ?? 0,
                impregPct: x.impregPct ?? 0,
                grossKg: x.grossKg ?? 0,
                netKg: x.netKg ?? 0,
                finalVisc: x.finalVisc ?? 0,
                note: x.note ?? '',
              }))
            : r.rolls,
        glassLots: data.glassLots ?? r.glassLots,
        glassRollKg: data.glassRollKg ?? r.glassRollKg,
        sampleGfPct: data.sampleGfPct ?? r.sampleGfPct,
        preShip: { ...r.preShip, ...(data.preShip ?? {}) },
        notes: data.notes ?? r.notes,
      }),
      { action: '생산일지 스캔 반영', detail: `${targetRun.lotNo} (롤 ${data.rolls?.length ?? 0}개 및 공정 데이터 자동 입력)` },
    )
    setScanOpen(false)
    setScanned(null)
  }

  // 인쇄용 양식 데이터 준비 (현재 열린 run 또는 상단 선택된 mixId/settingId 기준)
  const activeMix = run ? db.mixOrders.find((m) => m.id === run.mixOrderId) : db.mixOrders.find((m) => m.id === mixId)
  const activeRecipe = db.recipes.find((r) => r.id === activeMix?.recipeId) ?? db.recipes[0]
  const activeProduct = db.products.find((p) => p.id === activeRecipe?.productId) ?? db.products[0]
  const activeSetting = run
    ? db.settingRuns.find((s) => s.id === run.settingRunId)
    : db.settingRuns.find((s) => s.id === settingId)

  const blankLines = activeMix
    ? activeMix.lines.map((l) => ({
        materialId: l.materialId,
        batchKg: activeMix.batches > 0 ? l.planKg / activeMix.batches : l.planKg,
        totalKg: l.planKg,
      }))
    : activeRecipe
      ? scaleRecipe(activeRecipe.lines, db.materials, 350)
          .filter((l) => matOf(db, l.materialId)?.cat !== 'glass')
          .map((l) => ({ materialId: l.materialId, batchKg: l.kg, totalKg: l.kg }))
      : []

  const isBlankPrint = printMode === 'blank' || !run

  return (
    <>
      <div className="noprint">
        <Card
          title="새 생산일지 · 빈 양식 인쇄 · 사진 스캔"
          right={
            <div className="row">
              <button
                className="btn"
                onClick={() => triggerPrint('blank')}
                title="현장에서 수기로 작성할 수 있는 SMC 일일 생산일지 빈 양식을 인쇄합니다"
              >
                🖨️ 빈 생산일지 양식 인쇄
              </button>
              {db.mixOrders.length > 0 && (
                <button
                  className="btn"
                  onClick={() => {
                    if (run && run.status === 'open') {
                      setScanOpen(true)
                      setScanned(null)
                      setScanError('')
                    } else {
                      create(true)
                    }
                  }}
                >
                  📷 사진 찍어 스캔 입력
                </button>
              )}
            </div>
          }
        >
          {db.mixOrders.length === 0 ? (
            <Notice kind="info">
              먼저 배합지시서를 발행하면 생산일지를 작성할 수 있습니다. 우측 상단의 <b>「빈 생산일지 양식 인쇄」</b>는 지금 바로 출력 가능합니다.
            </Notice>
          ) : (
            <div className="grid g4">
              <Field label="배합지시서">
                <select value={mixId} onChange={(e) => { setMixId(e.target.value); setSettingId('') }}>
                  {db.mixOrders.map((m) => <option key={m.id} value={m.id}>{m.no} {m.status === 'done' ? '' : '(배합 미완료)'}</option>)}
                </select>
              </Field>
              <Field label="설정값 (저장한 계산)" hint="없으면 토출 목표가 비어 있습니다">
                <select value={settingId} onChange={(e) => setSettingId(e.target.value)}>
                  <option value="">선택 안 함</option>
                  {settingsForMix.map((s) => <option key={s.id} value={s.id}>{s.at.slice(5, 16).replace('T', ' ')} 속도 {s.input.speed} 단중 {s.input.arealKgM2}</option>)}
                </select>
              </Field>
              <Field label="생산일"><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
              <div style={{ alignSelf: 'end' }} className="row">
                <button className="btn pri" onClick={() => create(false)}>일지 작성 시작</button>
              </div>
            </div>
          )}
        </Card>

        <Card title="생산일지 목록">
          {db.runs.length === 0 ? <span className="mute">작성된 일지가 없습니다.</span> : (
            <div className="scroll">
              <table>
                <thead><tr><th>LOT</th><th>생산일</th><th className="r">롤 수</th><th className="r">실중량 합 (kg)</th><th>상태</th><th>작업</th></tr></thead>
                <tbody>
                  {db.runs.map((r) => (
                    <tr key={r.id}>
                      <td><b>{r.lotNo}</b></td><td>{r.date}</td><td className="r">{r.rolls.length}</td>
                      <td className="r">{fmt(r.rolls.reduce((s, x) => s + x.netKg, 0), 1)}</td>
                      <td><Badge kind={r.status === 'closed' ? 'ok' : 'info'}>{r.status === 'closed' ? '마감' : '작성 중'}</Badge></td>
                      <td>
                        <div className="row">
                          <button className="btn" onClick={() => { setOpenId(r.id); setPrintMode('') }}>열기</button>
                          <button className="btn" onClick={() => { setOpenId(r.id); setScanOpen(true); setScanned(null); setScanError('') }}>📷 스캔 입력</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        {/* 스마트 사진 촬영 / 스캔 입력 패널 */}
        {scanOpen && run && (
          <Card
            title={`📷 수기 생산일지 사진 스캔 · 데이터 자동 채우기 (${run.lotNo})`}
            right={
              <button className="btn" onClick={() => setScanOpen(false)}>닫기</button>
            }
          >
            <div className="scan-panel">
              <div className="grid g2" style={{ alignItems: 'start' }}>
                {/* 왼쪽: 사진 촬영 / 업로드 및 이미지 뷰어 */}
                <div className="scan-left">
                  <div className="row" style={{ marginBottom: 10 }}>
                    <button className="btn pri" onClick={() => cameraFileRef.current?.click()}>
                      📸 카메라로 일지 촬영
                    </button>
                    <button className="btn" onClick={() => scanFileRef.current?.click()}>
                      🖼️ 사진/스캔 파일 선택
                    </button>
                    <button
                      className="btn"
                      onClick={() => {
                        setScanError('')
                        setScanned(buildDemoScanData(db, run))
                      }}
                    >
                      ⚡ 샘플 일지 스캔 시연
                    </button>
                    <input
                      ref={cameraFileRef}
                      type="file"
                      accept="image/*"
                      capture="environment"
                      hidden
                      onChange={async (e) => {
                        const f = e.target.files?.[0]
                        if (!f) return
                        try {
                          setScanError('')
                          const res = await fileToScanImage(f)
                          setScanImg(res)
                          setScanned(null)
                        } catch (err) {
                          setScanError((err as Error).message)
                        }
                        e.target.value = ''
                      }}
                    />
                    <input
                      ref={scanFileRef}
                      type="file"
                      accept="image/*"
                      hidden
                      onChange={async (e) => {
                        const f = e.target.files?.[0]
                        if (!f) return
                        try {
                          setScanError('')
                          const res = await fileToScanImage(f)
                          setScanImg(res)
                          setScanned(null)
                        } catch (err) {
                          setScanError((err as Error).message)
                        }
                        e.target.value = ''
                      }}
                    />
                  </div>

                  {scanImg ? (
                    <div className="scan-viewer">
                      <div className="scan-toolbar">
                        <span>미리보기 배율: <b>{scanZoom}%</b></span>
                        <div className="row">
                          <button className="btn" onClick={() => setScanZoom((z) => Math.max(50, z - 25))}>-</button>
                          <button className="btn" onClick={() => setScanZoom(100)}>100%</button>
                          <button className="btn" onClick={() => setScanZoom((z) => Math.min(250, z + 25))}>+</button>
                          <button className="btn" onClick={() => setScanRot((r) => (r + 90) % 360)}>↻ 회전</button>
                        </div>
                      </div>
                      <div className="scan-canvas">
                        <img
                          src={scanImg.dataUrl}
                          alt="스캔된 생산일지"
                          style={{
                            width: `${scanZoom}%`,
                            transform: `rotate(${scanRot}deg)`,
                            transition: 'transform 0.2s ease',
                          }}
                        />
                      </div>
                    </div>
                  ) : (
                    <div className="scan-dropzone" onClick={() => scanFileRef.current?.click()}>
                      <div style={{ fontSize: 28, marginBottom: 6 }}>📷</div>
                      <b>인쇄하여 수기로 작성한 SMC 생산일지 사진을 촬영하거나 업로드하세요</b>
                      <span className="mute">스마트폰/태블릿에서는 카메라가 바로 실행되며, PC에서는 촬영한 이미지 파일을 선택할 수 있습니다.</span>
                    </div>
                  )}
                </div>

                {/* 오른쪽: AI OCR 실행 및 추출된 데이터 확인/반영 */}
                <div className="scan-right">
                  <div className="std-box" style={{ marginBottom: 12 }}>
                    <h4 style={{ marginTop: 0 }}>1. AI 자동 판독 (Vision OCR) 설정</h4>
                    <div className="grid g2">
                      <Field label="AI 엔진">
                        <select
                          value={db.settings.ocrProvider || 'gemini'}
                          onChange={(e) => update((d) => ({ ...d, settings: { ...d.settings, ocrProvider: e.target.value as 'gemini' | 'openai' } }))}
                        >
                          <option value="gemini">Google Gemini (gemini-2.5-flash)</option>
                          <option value="openai">OpenAI (gpt-4o-mini)</option>
                        </select>
                      </Field>
                      <Field label="API Key (한 번 입력 시 자동 저장)">
                        <input
                          type="password"
                          placeholder="AIza... 또는 sk-..."
                          value={db.settings.ocrApiKey || ''}
                          onChange={(e) => update((d) => ({ ...d, settings: { ...d.settings, ocrApiKey: e.target.value.trim() } }))}
                        />
                      </Field>
                    </div>
                    <div className="row" style={{ marginTop: 10 }}>
                      <button
                        className="btn pri"
                        disabled={!scanImg || scanBusy}
                        onClick={async () => {
                          if (!scanImg) return
                          setScanBusy(true)
                          setScanError('')
                          try {
                            const res = await runVisionOCR(db, run, scanImg)
                            setScanned(res)
                          } catch (err) {
                            setScanError((err as Error).message)
                          } finally {
                            setScanBusy(false)
                          }
                        }}
                      >
                        {scanBusy ? '⏳ 사진에서 데이터 추출 중…' : '✨ AI로 사진 속 수기 데이터 자동 추출'}
                      </button>
                      <span className="mute" style={{ fontSize: 12 }}>
                        API 키가 없다면 왼쪽의 <b>「⚡ 샘플 일지 스캔 시연」</b>으로 즉시 테스트할 수 있습니다.
                      </span>
                    </div>
                  </div>

                  {scanError && <Notice kind="bad">{scanError}</Notice>}

                  {scanned && (
                    <div className="std-box" style={{ borderColor: '#93c5fd', background: '#f8fafc' }}>
                      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
                        <h4 style={{ margin: 0 }}>2. 스캔 추출 데이터 미리보기</h4>
                        <Badge kind="ok">판독 완료</Badge>
                      </div>
                      <div className="grid g4" style={{ marginBottom: 10 }}>
                        <div className="kpi"><b>{scanned.tempC ?? '-'} ℃ / {scanned.humidity ?? '-'} %</b><span>온도 / 습도 ({scanned.weather || '맑음'})</span></div>
                        <div className="kpi"><b>{scanned.viscosity?.[0]?.ps ?? '-'} → {scanned.viscosity?.[5]?.ps ?? '-'} PS</b><span>점도 (초기 → 25분)</span></div>
                        <div className="kpi"><b>{scanned.rolls?.length ?? 0} 롤</b><span>인식된 생산 롤 수</span></div>
                        <div className="kpi"><b>{fmt((scanned.rolls ?? []).reduce((s, r) => s + (r.netKg ?? 0), 0), 1)} kg</b><span>인식된 실중량 합계</span></div>
                      </div>
                      <div className="mute" style={{ fontSize: 12.5, marginBottom: 12 }}>
                        • 원재료 Lot 및 실사용량 <b>{Object.keys(scanned.actualUse ?? {}).length}건</b> · 토출 실측(컴파운드 <b>{scanned.dischargeMeasured?.compound ?? '-'}</b> kg/min, 증점제 <b>{scanned.dischargeMeasured?.mgo ?? '-'}</b> g/min, 조색제 <b>{scanned.dischargeMeasured?.color ?? '-'}</b> g/min)<br />
                        • 유리섬유 Lot: <b>{scanned.glassLots || '-'}</b> ({scanned.glassRollKg ?? 0} kg, 함량 {scanned.sampleGfPct ?? '-'} %)
                      </div>
                      <div className="row">
                        <button className="btn pri" onClick={() => applyScannedData(run, scanned)}>
                          ✅ 이 데이터를 생산일지에 일괄 반영하기
                        </button>
                        <button className="btn" onClick={() => setScanned(null)}>취소</button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </Card>
        )}

        {run && (() => {
          const mix = db.mixOrders.find((m) => m.id === run.mixOrderId)
          const recipe = db.recipes.find((r) => r.id === mix?.recipeId)
          const st = db.settingRuns.find((s) => s.id === run.settingRunId)
          const locked = run.status === 'closed'
          const P = (fn: (r: ProductionRun) => ProductionRun) => patch(run.id, fn)
          const netSum = run.rolls.reduce((s, x) => s + x.netKg, 0)
          const grossSum = run.rolls.reduce((s, x) => s + x.grossKg, 0)
          const matKg = Object.values(run.actualUse).reduce((s, v) => s + v, 0)
          const inKg = matKg + run.glassRollKg
          const yieldPct = inKg > 0 ? (netSum / inKg) * 100 : 0
          const allOk = PRESHIP.every(([k]) => run.preShip[k] === 'ok')
          const canClose = run.rolls.length > 0 && netSum > 0 && allOk
          const judge = (x: Roll) => {
            const bad: string[] = []
            if (run.targetArealKgM2 > 0 && x.arealKgM2 > 0 && Math.abs(x.arealKgM2 - run.targetArealKgM2) > db.settings.arealTolKg) bad.push('단중')
            if (run.targetWidthMm > 0 && x.widthMm > 0 && Math.abs(x.widthMm - run.targetWidthMm) > db.settings.widthTolMm) bad.push('폭')
            if (run.targetThicknessMm > 0 && x.thicknessMm > 0 && Math.abs(x.thicknessMm - run.targetThicknessMm) > db.settings.thicknessTolMm) bad.push('두께')
            return bad
          }
          const addRoll = () => P((r) => ({
            ...r,
            rolls: [...r.rolls, { widthMm: st?.input.widthMm ?? r.targetWidthMm, speed: st?.input.speed ?? 0, db1: st ? Number(st.output.boxGapMm.toFixed(3)) : 0, db2: st ? Number(st.output.boxGapMm.toFixed(3)) : 0, cut1: Number((st?.output.cutterRpm[0] ?? 0).toFixed(1)), cut2: Number((st?.output.cutterRpm[1] ?? 0).toFixed(1)), arealKgM2: 0, thicknessMm: 0, impregPct: 0, grossKg: 0, netKg: 0, finalVisc: 0, note: '' }],
          }))
          const setRoll = (i: number, p: Partial<Roll>) => P((r) => ({ ...r, rolls: r.rolls.map((x, j) => (j === i ? { ...x, ...p } : x)) }))
          const diffPct = (m: number, t: number) => (t > 0 && m > 0 ? ((m - t) / t) * 100 : null)

          const close = () => {
            const producedAt = new Date(`${run.date}T${new Date().toTimeString().slice(0, 5)}:00`).toISOString()
            const gf = run.sampleGfPct ?? (recipe ? Number((glassFraction(recipe.lines, db.materials) * 100).toFixed(2)) : 0)
            update((d) => ({
              ...d,
              runs: d.runs.map((r) => (r.id === run.id ? { ...r, status: 'closed' } : r)),
              lots: [...d.lots, { id: uid('l'), lotNo: run.lotNo, runId: run.id, productCode: run.productCode, producedAt, gfPct: gf, grossKg: grossSum, netKg: netSum, released: false, note: '' }],
            }), { action: '생산일지 마감', detail: `${run.lotNo} 실중량 ${fmt(netSum, 1)}kg` })
          }

          return (
            <>
              <Card
                title={`생산일지 ${run.lotNo}`}
                right={
                  <div className="row">
                    {!locked && (
                      <button className="btn pri" onClick={() => { setScanOpen(true); setScanned(null); setScanError('') }}>
                        📷 사진 찍어 스캔 입력
                      </button>
                    )}
                    <button className="btn" onClick={() => triggerPrint('blank')}>
                      🖨️ 빈 양식 인쇄
                    </button>
                    <button className="btn" onClick={() => triggerPrint('filled')}>
                      🖨️ 작성 일지 인쇄
                    </button>
                    <button className="btn" onClick={() => setOpenId('')}>닫기</button>
                  </div>
                }
              >
                <div className="grid g4">
                  <Field label="제품 코드"><input value={run.productCode} disabled={locked} onChange={(e) => P((r) => ({ ...r, productCode: e.target.value }))} /></Field>
                  <Field label="LOT"><b>{run.lotNo}</b></Field>
                  <Field label="배합지시서"><b>{mix?.no} {recipe ? `· ${recipeName(recipe)}` : ''}</b></Field>
                  <Field label="생산일"><input type="date" value={run.date} disabled={locked} onChange={(e) => P((r) => ({ ...r, date: e.target.value }))} /></Field>
                  <Field label="온도 (℃)"><Num value={run.tempC} disabled={locked} onChange={(n) => P((r) => ({ ...r, tempC: n }))} /></Field>
                  <Field label="습도 (%)"><Num value={run.humidity} disabled={locked} onChange={(n) => P((r) => ({ ...r, humidity: n }))} /></Field>
                  <Field label="날씨">
                    <select value={run.weather} disabled={locked} onChange={(e) => P((r) => ({ ...r, weather: e.target.value }))}>{['맑음', '흐림', '비', '눈'].map((w) => <option key={w}>{w}</option>)}</select>
                  </Field>
                  <Field label="작업 인원"><Num value={run.workers} disabled={locked} onChange={(n) => P((r) => ({ ...r, workers: n }))} /></Field>
                  <Field label="목표 단중 (kg/m²)"><Num value={run.targetArealKgM2} disabled={locked} onChange={(n) => P((r) => ({ ...r, targetArealKgM2: n }))} /></Field>
                  <Field label="목표 폭 (mm)"><Num value={run.targetWidthMm} disabled={locked} onChange={(n) => P((r) => ({ ...r, targetWidthMm: n }))} /></Field>
                  <Field label="목표 두께 (mm)" hint="0이면 두께 판정 안 함"><Num value={run.targetThicknessMm} disabled={locked} onChange={(n) => P((r) => ({ ...r, targetThicknessMm: n }))} /></Field>
                  <Field label="비가동·준비·청소 내역"><input value={run.downtime} disabled={locked} onChange={(e) => P((r) => ({ ...r, downtime: e.target.value }))} /></Field>
                </div>
                {mix?.status !== 'done' && <Notice kind="warn">연결된 배합지시서가 아직 완료되지 않았습니다.</Notice>}
              </Card>

              <Card title="원재료 투입량 (지시량 · 실사용량 · Lot)">
                <div className="scroll">
                  <table>
                    <thead><tr><th>원재료</th><th className="r">지시량 (kg)</th><th className="r">실사용량 (kg)</th><th>원재료 Lot</th></tr></thead>
                    <tbody>
                      {mix?.lines.map((l) => (
                        <tr key={l.materialId}>
                          <td>{matLabel(db, l.materialId)}</td>
                          <td className="r">{fmt(l.planKg, 2)}</td>
                          <td className="r"><Num value={run.actualUse[l.materialId] ?? 0} disabled={locked} onChange={(n) => P((r) => ({ ...r, actualUse: { ...r.actualUse, [l.materialId]: n } }))} /></td>
                          <td><input value={run.matLots[l.materialId] ?? ''} disabled={locked} onChange={(e) => P((r) => ({ ...r, matLots: { ...r.matLots, [l.materialId]: e.target.value } }))} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>

              <Card title="점도 확인 (PS / ℃)">
                <div className="scroll">
                  <table>
                    <thead><tr><th>구분</th>{run.viscosity.map((v) => <th key={v.label}>{v.label}</th>)}</tr></thead>
                    <tbody>
                      <tr><td><b>점도 (PS)</b></td>{run.viscosity.map((v, i) => <td key={i}><Num width={70} value={v.ps} disabled={locked} onChange={(n) => P((r) => ({ ...r, viscosity: r.viscosity.map((x, j) => (j === i ? { ...x, ps: n } : x)) }))} /></td>)}</tr>
                      <tr><td><b>온도 (℃)</b></td>{run.viscosity.map((v, i) => <td key={i}><Num width={70} value={v.tempC} disabled={locked} onChange={(n) => P((r) => ({ ...r, viscosity: r.viscosity.map((x, j) => (j === i ? { ...x, tempC: n } : x)) }))} /></td>)}</tr>
                    </tbody>
                  </table>
                </div>
              </Card>

              <Card title="토출량 확인 (목표는 저장한 설정값에서 자동)">
                {!st && <Notice kind="info">설정값을 연결하지 않아 목표가 없습니다. 설정값 계산 화면에서 저장한 뒤 새 일지에서 선택하세요.</Notice>}
                <div className="scroll">
                  <table>
                    <thead><tr><th>항목</th><th className="r">목표</th><th className="r">실측</th><th className="r">차이</th></tr></thead>
                    <tbody>
                      {([['compound', '컴파운드 (kg/min)', st?.output.pumpA ?? 0], ['mgo', '증점제 (g/min)', st?.output.pumpMgO ?? 0], ['color', '조색제 (g/min)', st?.output.pumpColor ?? 0]] as const).map(([k, label, t]) => {
                        const m = run.dischargeMeasured[k]
                        const dp = diffPct(m, t)
                        return (
                          <tr key={k}>
                            <td>{label}</td><td className="r">{fmt(t, 3)}</td>
                            <td className="r"><Num value={m} disabled={locked} onChange={(n) => P((r) => ({ ...r, dischargeMeasured: { ...r.dischargeMeasured, [k]: n } }))} /></td>
                            <td className="r">{dp === null ? '-' : `${dp > 0 ? '+' : ''}${fmt(dp, 1)} %`}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </Card>

              <Card title="롤별 생산 기록" right={!locked && <button className="btn pri" onClick={addRoll}>롤 추가 (설정값 자동 입력)</button>}>
                <div className="scroll">
                  <table>
                    <thead>
                      <tr><th>No</th><th className="r">폭 (mm)</th><th className="r">속도</th><th className="r">D/B 1</th><th className="r">D/B 2</th><th className="r">컷터1</th><th className="r">컷터2</th><th className="r">단중</th><th className="r">두께</th><th className="r">함침 %</th><th className="r">총중량</th><th className="r">실중량</th><th className="r">말기점도</th><th>판정</th><th>비고</th><th></th></tr>
                    </thead>
                    <tbody>
                      {run.rolls.map((x, i) => {
                        const bad = judge(x)
                        return (
                          <tr key={i}>
                            <td><b>{i + 1}</b></td>
                            {(['widthMm', 'speed', 'db1', 'db2', 'cut1', 'cut2', 'arealKgM2', 'thicknessMm', 'impregPct', 'grossKg', 'netKg', 'finalVisc'] as const).map((k) => (
                              <td key={k} className="r"><Num width={64} value={x[k]} disabled={locked} onChange={(n) => setRoll(i, { [k]: n })} /></td>
                            ))}
                            <td>{bad.length ? <Badge kind="bad">{bad.join('·')} 이탈</Badge> : x.arealKgM2 > 0 ? <Badge kind="ok">정상</Badge> : '-'}</td>
                            <td><input value={x.note} disabled={locked} onChange={(e) => setRoll(i, { note: e.target.value })} /></td>
                            <td>{!locked && <button className="btn dan" onClick={() => P((r) => ({ ...r, rolls: r.rolls.filter((_, j) => j !== i) }))}>삭제</button>}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
                <div className="grid g4" style={{ marginTop: 10 }}>
                  <div className="kpi"><b>{fmt(grossSum, 1)} kg</b><span>총중량 합계</span></div>
                  <div className="kpi"><b>{fmt(netSum, 1)} kg</b><span>실중량 합계</span></div>
                  <div className="kpi"><b>{inKg > 0 ? `${fmt(yieldPct, 1)} %` : '-'}</b><span>생산 수율 (실중량 ÷ 투입 합계)</span></div>
                </div>
              </Card>

              <Card title="유리섬유 체크">
                <div className="grid g4">
                  <Field label="유리섬유 Lot"><input value={run.glassLots} disabled={locked} onChange={(e) => P((r) => ({ ...r, glassLots: e.target.value }))} /></Field>
                  <Field label="유리섬유 전체 사용량 (kg)"><Num value={run.glassRollKg} disabled={locked} onChange={(n) => P((r) => ({ ...r, glassRollKg: n }))} /></Field>
                  <Field label="시료 전체 중량 (g)" hint="중량법: 전체 − 수지 = 유리섬유"><Num value={sampleTotal} onChange={setSampleTotal} /></Field>
                  <Field label="시료 수지 중량 (g)"><Num value={samplePaste} onChange={setSamplePaste} /></Field>
                </div>
                <div className="row" style={{ marginTop: 8 }}>
                  {sampleTotal > samplePaste && samplePaste > 0 ? (
                    <>
                      <span>실측 유리섬유 함량 <b>{fmt(((sampleTotal - samplePaste) / sampleTotal) * 100, 2)} %</b></span>
                      {!locked && <button className="btn" onClick={() => P((r) => ({ ...r, sampleGfPct: Number((((sampleTotal - samplePaste) / sampleTotal) * 100).toFixed(2)) }))}>일지에 기록</button>}
                    </>
                  ) : <span className="mute">시료 중량을 입력하면 함량이 계산됩니다.</span>}
                  {run.sampleGfPct !== undefined && <Badge kind="info">기록된 함량 {run.sampleGfPct} %</Badge>}
                </div>
              </Card>

              <Card title="출고 전 최종 품질 확인">
                <div className="scroll">
                  <table>
                    <thead><tr><th>점검 항목</th><th>관리 기준</th><th>결과</th></tr></thead>
                    <tbody>
                      {PRESHIP.map(([k, name, std]) => (
                        <tr key={k}>
                          <td><b>{name}</b></td><td className="mute">{std}</td>
                          <td>
                            <select value={run.preShip[k] ?? ''} disabled={locked} onChange={(e) => P((r) => ({ ...r, preShip: { ...r.preShip, [k]: e.target.value as 'ok' | 'ng' | '' } }))}>
                              <option value="">미점검</option><option value="ok">합격</option><option value="ng">불합격</option>
                            </select>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>

              <Card title="특이사항 및 조치">
                <textarea value={run.notes} disabled={locked} onChange={(e) => P((r) => ({ ...r, notes: e.target.value }))} />
                <div className="row" style={{ marginTop: 8 }}>
                  <button className="btn pri" disabled={locked || !canClose || noUser} onClick={close}>일지 마감 · 로트 등록</button>
                  {locked ? <Badge kind="ok">마감됨 (로트 등록 완료)</Badge> : <span className="mute">마감 조건: 롤 1개 이상(실중량 입력), 출고 전 5항목 모두 합격{noUser ? ', 작업자 이름' : ''}</span>}
                </div>
              </Card>
            </>
          )
        })()}
      </div>

      {/* 인쇄 전용 A4 SMC 일일 생산일지 (빈 양식 또는 작성된 일지) */}
      <section className="card printable printonly prod-print-sheet">
        <div className="doc-banner" style={{ marginBottom: 6, padding: '4px 8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div className="doc-brand" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {db.settings.companyLogo ? (
              <img src={db.settings.companyLogo} alt="logo" className="doc-logo" style={{ maxHeight: 32 }} />
            ) : (
              <div className="brand-mark" style={{ width: 32, height: 32, fontSize: 11, borderRadius: 6 }}>SMC</div>
            )}
            <div>
              <div className="doc-title" style={{ fontSize: 17, fontWeight: 800 }}>SMC 일일 생산일지 {isBlankPrint ? '(현장 기록용 양식)' : ''}</div>
              <div className="doc-sub" style={{ fontSize: 9.5 }}>{db.settings.companyName} · Daily Production Log</div>
            </div>
          </div>
          <table style={{ width: 180, borderCollapse: 'collapse', border: '1.5px solid #000', textAlign: 'center', flexShrink: 0, margin: 0 }}>
            <thead>
              <tr style={{ background: '#f1f5f9', height: 18 }}>
                <th style={{ border: '1px solid #000', fontSize: 9.5, width: 60, padding: 0 }}>작성</th>
                <th style={{ border: '1px solid #000', fontSize: 9.5, width: 60, padding: 0 }}>검토</th>
                <th style={{ border: '1px solid #000', fontSize: 9.5, width: 60, padding: 0 }}>승인</th>
              </tr>
            </thead>
            <tbody>
              <tr style={{ height: 26 }}>
                <td style={{ border: '1px solid #000', fontSize: 9.5, padding: 0 }}>{!isBlankPrint ? db.user : ''}</td>
                <td style={{ border: '1px solid #000', padding: 0 }}></td>
                <td style={{ border: '1px solid #000', padding: 0 }}></td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* 1. 기본사항 */}
        <div className="print-sec-title">1. 기본 사항</div>
        <table className="print-tbl" style={{ marginBottom: 6, width: '100%' }}>
          <tbody>
            <tr>
              <th style={{ width: 75 }}>품명</th>
              <td><b>{activeProduct?.name ?? 'SMC 물탱크용'}</b> ({run?.productCode || activeProduct?.code || ''})</td>
              <th style={{ width: 75 }}>제품 LOT</th>
              <td><b>{!isBlankPrint && run ? run.lotNo : `${db.settings.siteCode}______-__`}</b></td>
              <th style={{ width: 70 }}>생산일자</th>
              <td>{!isBlankPrint && run ? run.date : '2026-  -  '}</td>
              <th style={{ width: 75 }}>생산 Batch</th>
              <td>{activeMix ? `${activeMix.batches} Batch (${activeMix.no})` : '____ Batch'}</td>
            </tr>
            <tr>
              <th>온도 (℃)</th>
              <td>{!isBlankPrint && run && run.tempC ? `${run.tempC} ℃` : '        ℃'}</td>
              <th>습도 (%)</th>
              <td>{!isBlankPrint && run && run.humidity ? `${run.humidity} %` : '        %'}</td>
              <th>날씨</th>
              <td>{!isBlankPrint && run ? run.weather : '맑음 / 흐림 / 비'}</td>
              <th>작업인원</th>
              <td>{!isBlankPrint && run ? `${run.workers} 명` : '      명'}</td>
            </tr>
            <tr>
              <th>비가동·준비·청소</th>
              <td colSpan={7}>{!isBlankPrint && run ? run.downtime : ''}</td>
            </tr>
          </tbody>
        </table>

        {/* 2. 원재료 투입량 & 3. 점도/토출 확인 (좌우 배치) */}
        <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 6, marginBottom: 6 }}>
          <div>
            <div className="print-sec-title">2. 원재료 투입량 (Lot 포함)</div>
            <table className="print-tbl" style={{ width: '100%' }}>
              <thead>
                <tr>
                  <th style={{ width: 26 }}>No</th>
                  <th>품목 (규격)</th>
                  <th>원재료 Lot No.</th>
                  <th className="r" style={{ width: 55 }}>1배치(Kg)</th>
                  <th className="r" style={{ width: 62 }}>총지시량(Kg)</th>
                  <th className="r" style={{ width: 62 }}>실사용량(Kg)</th>
                </tr>
              </thead>
              <tbody>
                {blankLines.map((l, i) => (
                  <tr key={l.materialId}>
                    <td style={{ textAlign: 'center' }}>{i + 1}</td>
                    <td>{matLabel(db, l.materialId)}</td>
                    <td>{!isBlankPrint && run ? (run.matLots[l.materialId] ?? '') : ''}</td>
                    <td className="r">{fmt(l.batchKg, 1)}</td>
                    <td className="r">{fmt(l.totalKg, 1)}</td>
                    <td className="r">{!isBlankPrint && run && run.actualUse[l.materialId] ? fmt(run.actualUse[l.materialId], 1) : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div>
            <div className="print-sec-title">3. 점도 확인 (PS / ℃)</div>
            <table className="print-tbl" style={{ marginBottom: 6, width: '100%' }}>
              <thead>
                <tr>
                  <th>구분</th>
                  {VISC_LABELS.map((lb) => <th key={lb} className="r">{lb}</th>)}
                </tr>
              </thead>
              <tbody>
                <tr>
                  <th>점도 (PS)</th>
                  {VISC_LABELS.map((lb, i) => (
                    <td key={lb} className="r" style={{ height: 20 }}>
                      {!isBlankPrint && run && run.viscosity[i]?.ps ? run.viscosity[i].ps : ''}
                    </td>
                  ))}
                </tr>
                <tr>
                  <th>온도 (℃)</th>
                  {VISC_LABELS.map((lb, i) => (
                    <td key={lb} className="r" style={{ height: 20 }}>
                      {!isBlankPrint && run && run.viscosity[i]?.tempC ? run.viscosity[i].tempC : ''}
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>

            <div className="print-sec-title">4. 펌프 3계통 토출량 확인</div>
            <table className="print-tbl" style={{ width: '100%' }}>
              <thead>
                <tr><th>항목</th><th className="r">목표(자동)</th><th className="r">실측</th><th>단위</th></tr>
              </thead>
              <tbody>
                <tr>
                  <td>컴파운드 (Paste A)</td>
                  <td className="r">{activeSetting ? fmt(activeSetting.output.pumpA, 2) : '-'}</td>
                  <td className="r">{!isBlankPrint && run && run.dischargeMeasured.compound ? fmt(run.dischargeMeasured.compound, 2) : ''}</td>
                  <td>kg/min</td>
                </tr>
                <tr>
                  <td>증점제 (MgO)</td>
                  <td className="r">{activeSetting ? fmt(activeSetting.output.pumpMgO, 1) : '-'}</td>
                  <td className="r">{!isBlankPrint && run && run.dischargeMeasured.mgo ? fmt(run.dischargeMeasured.mgo, 1) : ''}</td>
                  <td>g/min</td>
                </tr>
                <tr>
                  <td>조색제 (Color)</td>
                  <td className="r">{activeSetting ? fmt(activeSetting.output.pumpColor, 1) : '-'}</td>
                  <td className="r">{!isBlankPrint && run && run.dischargeMeasured.color ? fmt(run.dischargeMeasured.color, 1) : ''}</td>
                  <td>g/min</td>
                </tr>
              </tbody>
            </table>

            <div className="print-sec-title" style={{ marginTop: 6 }}>5. 유리섬유 체크 (중량법)</div>
            <table className="print-tbl" style={{ width: '100%' }}>
              <tbody>
                <tr>
                  <th style={{ width: 85 }}>유리섬유 Lot</th>
                  <td>{!isBlankPrint && run ? run.glassLots : ''}</td>
                  <th style={{ width: 95 }}>전체 사용량(Kg)</th>
                  <td style={{ width: 60 }} className="r">{!isBlankPrint && run && run.glassRollKg ? fmt(run.glassRollKg, 1) : ''}</td>
                  <th style={{ width: 85 }}>실측 함량(%)</th>
                  <td style={{ width: 60 }} className="r">{!isBlankPrint && run && run.sampleGfPct !== undefined ? `${run.sampleGfPct}%` : '      %'}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* 6. 롤별 생산 확인 */}
        <div className="print-sec-title">
          6. SMC 생산 확인 (권장 설정값 — 폭: {activeSetting?.input.widthMm ?? activeProduct?.widthMm ?? 1100}mm / 속도: {activeSetting?.input.speed ?? 10}m/min / D/B 1·2: {activeSetting ? fmt(activeSetting.output.boxGapMm, 2) : '-'}mm / 컷터 1·2: {activeSetting ? activeSetting.output.cutterRpm.map((r) => (r === null ? 'OFF' : fmt(r, 1))).join('/') : '-'} RPM / 목표단중: {activeSetting?.input.arealKgM2 ?? activeProduct?.arealKgM2 ?? 4.6}kg/㎡)
        </div>
        <table className="print-tbl roll-tbl" style={{ marginBottom: 6, width: '100%', tableLayout: 'fixed' }}>
          <thead>
            <tr>
              <th style={{ width: 28 }}>No</th>
              <th className="r" style={{ width: 68 }}>제품폭(mm)</th>
              <th className="r" style={{ width: 68 }}>속도(m/min)</th>
              <th className="r" style={{ width: 62 }}>D/B 1(mm)</th>
              <th className="r" style={{ width: 62 }}>D/B 2(mm)</th>
              <th className="r" style={{ width: 64 }}>컷터1 RPM</th>
              <th className="r" style={{ width: 64 }}>컷터2 RPM</th>
              <th className="r" style={{ width: 64 }}>단중(kg/㎡)</th>
              <th className="r" style={{ width: 58 }}>두께(mm)</th>
              <th className="r" style={{ width: 54 }}>함침(%)</th>
              <th className="r" style={{ width: 68 }}>총중량(kg)</th>
              <th className="r" style={{ width: 68 }}>실중량(kg)</th>
              <th className="r" style={{ width: 60 }}>말기점도</th>
              <th>비고</th>
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: Math.max(12, !isBlankPrint && run ? run.rolls.length : 12) }).map((_, i) => {
              const r = !isBlankPrint && run ? run.rolls[i] : undefined
              return (
                <tr key={i}>
                  <td style={{ textAlign: 'center', height: 18 }}>{i + 1}</td>
                  <td className="r">{r?.widthMm || ''}</td>
                  <td className="r">{r?.speed || ''}</td>
                  <td className="r">{r?.db1 || ''}</td>
                  <td className="r">{r?.db2 || ''}</td>
                  <td className="r">{r?.cut1 || ''}</td>
                  <td className="r">{r?.cut2 || ''}</td>
                  <td className="r">{r?.arealKgM2 || ''}</td>
                  <td className="r">{r?.thicknessMm || ''}</td>
                  <td className="r">{r?.impregPct || ''}</td>
                  <td className="r">{r?.grossKg || ''}</td>
                  <td className="r">{r?.netKg || ''}</td>
                  <td className="r">{r?.finalVisc || ''}</td>
                  <td>{r?.note || ''}</td>
                </tr>
              )
            })}
            <tr>
              <th colSpan={10} className="r">합계 (TTL)</th>
              <th className="r">{!isBlankPrint && run ? fmt(run.rolls.reduce((s, x) => s + x.grossKg, 0), 1) : ''}</th>
              <th className="r">{!isBlankPrint && run ? fmt(run.rolls.reduce((s, x) => s + x.netKg, 0), 1) : ''}</th>
              <th>생산수율</th>
              <th></th>
            </tr>
          </tbody>
        </table>

        {/* 7. 출고 전 품질 확인 & 8. 특이사항 */}
        <div style={{ display: 'grid', gridTemplateColumns: '1.25fr 1fr', gap: 6 }}>
          <div>
            <div className="print-sec-title">7. 출고 전 최종 품질 확인</div>
            <table className="print-tbl" style={{ width: '100%' }}>
              <thead>
                <tr><th>점검 항목</th><th>관리 기준</th><th style={{ width: 72 }}>판정(O/X)</th></tr>
              </thead>
              <tbody>
                {PRESHIP.map(([k, name, std]) => (
                  <tr key={k}>
                    <td style={{ height: 19 }}><b>{name}</b></td>
                    <td>{std}</td>
                    <td style={{ textAlign: 'center' }}>
                      {!isBlankPrint && run && run.preShip[k] ? (run.preShip[k] === 'ok' ? '합격(O)' : '불합격(X)') : '□합격 □불합격'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <div className="print-sec-title">8. 특이사항 및 조치내역</div>
            <div className="notes-box" style={{ border: '1px solid #334155', flex: 1, minHeight: 96, padding: 6, fontSize: 9.5 }}>
              {!isBlankPrint && run ? run.notes : ''}
            </div>
          </div>
        </div>
      </section>
    </>
  )
}
