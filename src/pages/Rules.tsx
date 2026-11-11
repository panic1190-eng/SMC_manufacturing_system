import { useRef } from 'react'
import { Card, Field, Notice, Num } from '../ui'
import { exportJSON, importJSON, resetDB, update, useDB } from '../store'
import { download } from '../util'
import type { Settings } from '../types'
import { APP_VERSION } from '../App'

const ROWS: { key: keyof Settings; label: string; unit: string; src: string }[] = [
  { key: 'storageTempMaxC', label: '시트 보관 온도 상한', unit: '℃', src: '시트 관리 수칙(40℃)과 시트관리가이드(30℃)가 상충 — 결정 필요' },
  { key: 'fillerTempMaxC', label: '충진제 투입 중 온도 상한', unit: '℃', src: '공정 표준서 STEP 5' },
  { key: 'mixRpmMax', label: '교반 최대 RPM', unit: 'RPM', src: '공정 표준서' },
  { key: 'arealTolKg', label: '단중 허용 오차', unit: 'kg', src: '공정 표준서 시트 검사 (설계 기준 ±0.1 kg)' },
  { key: 'widthTolMm', label: '폭 허용 오차', unit: 'mm', src: '공정 표준서 (설계 폭 ±2 mm)' },
  { key: 'thicknessTolMm', label: '두께 허용 오차', unit: 'mm', src: '공정 표준서 (설계 두께 ±0.1 mm)' },
  { key: 'matureMinH', label: '최소 숙성 시간', unit: '시간', src: '시트 관리 수칙 (18~36시간)' },
  { key: 'matureMaxH', label: '권장 숙성 상한', unit: '시간', src: '시트 관리 수칙' },
  { key: 'shelfMonths', label: '사용기한', unit: '개월', src: '완제품 라벨 수식(생산일 + 2개월)' },
  { key: 'cutterBladeChangeTon', label: '커터 날 정기 교체 누적 생산량', unit: '톤', src: '기계 관리 가이드 (300톤 또는 월 1회)' },
]

/** 이미지 파일을 로컬 저장소에 부담 없는 크기의 Data URL로 변환 */
export function fileToLogoDataUrl(file: File, maxW = 360, maxH = 140): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('파일을 읽을 수 없습니다.'))
    reader.onload = () => {
      const dataUrl = reader.result as string
      if (file.type === 'image/svg+xml') {
        resolve(dataUrl)
        return
      }
      const img = new Image()
      img.onerror = () => reject(new Error('이미지 형식이 올바르지 않습니다.'))
      img.onload = () => {
        let w = img.width
        let h = img.height
        if (w > maxW || h > maxH) {
          const r = Math.min(maxW / w, maxH / h)
          w = Math.round(w * r)
          h = Math.round(h * r)
        }
        const canvas = document.createElement('canvas')
        canvas.width = w
        canvas.height = h
        const ctx = canvas.getContext('2d')
        if (!ctx) {
          resolve(dataUrl)
          return
        }
        ctx.drawImage(img, 0, 0, w, h)
        resolve(canvas.toDataURL('image/png'))
      }
      img.src = dataUrl
    }
    reader.readAsDataURL(file)
  })
}

export default function Rules() {
  const db = useDB()
  const file = useRef<HTMLInputElement>(null)
  const logoFile = useRef<HTMLInputElement>(null)

  const set = (k: keyof Settings, v: number | string) =>
    update((d) => ({ ...d, settings: { ...d.settings, [k]: v } }), { action: '기준값 변경', detail: `${k}=${k === 'companyLogo' ? '(로고 이미지)' : k === 'ocrApiKey' ? '***' : v}` })

  return (
    <>
      <div className="grid g2">
        <Card title="회사 브랜드 · 로고 설정">
          <div className="logo-setting-box">
            <div className="logo-preview" onClick={() => logoFile.current?.click()} title="클릭하여 로고 이미지 업로드">
              {db.settings.companyLogo ? (
                <img src={db.settings.companyLogo} alt="회사 로고" />
              ) : (
                <div className="logo-placeholder">
                  <b>+ 로고 업로드</b>
                  <span>PNG · JPG · SVG</span>
                </div>
              )}
            </div>
            <div style={{ flex: 1 }}>
              <Field label="회사명 / 시스템 타이틀" hint="좌측 메뉴 상단 및 인쇄 양식(배합지시서·생산일지·공정표준서·라벨)에 표시됩니다.">
                <input
                  value={db.settings.companyName}
                  placeholder="예: 하영비나 (HYVINA) / YSACC"
                  onChange={(e) => set('companyName', e.target.value)}
                />
              </Field>
              <div className="row" style={{ marginTop: 10 }}>
                <button className="btn pri" onClick={() => logoFile.current?.click()}>
                  로고 이미지 등록/변경
                </button>
                {db.settings.companyLogo && (
                  <button className="btn dan" onClick={() => set('companyLogo', '')}>
                    로고 삭제
                  </button>
                )}
                <input
                  ref={logoFile}
                  type="file"
                  accept="image/*"
                  hidden
                  onChange={async (e) => {
                    const f = e.target.files?.[0]
                    if (!f) return
                    try {
                      const url = await fileToLogoDataUrl(f)
                      set('companyLogo', url)
                    } catch (err) {
                      alert((err as Error).message)
                    }
                    e.target.value = ''
                  }}
                />
              </div>
            </div>
          </div>
        </Card>

        <Card title="생산일지 사진 스캔 (Vision AI OCR) 설정">
          <div className="grid g2">
            <Field label="AI 인식 엔진">
              <select
                value={db.settings.ocrProvider || 'gemini'}
                onChange={(e) => set('ocrProvider', e.target.value as 'gemini' | 'openai')}
              >
                <option value="gemini">Google Gemini Vision (권장 · gemini-2.5-flash)</option>
                <option value="openai">OpenAI Vision (gpt-4o-mini)</option>
              </select>
            </Field>
            <Field label="API Key (선택)" hint="키를 입력하면 촬영한 수기 일지 사진에서 숫자를 자동 추출합니다.">
              <input
                type="password"
                placeholder="AIza... 또는 sk-..."
                value={db.settings.ocrApiKey || ''}
                onChange={(e) => set('ocrApiKey', e.target.value.trim())}
              />
            </Field>
          </div>
          <p className="mute" style={{ margin: '10px 0 0', fontSize: 12.5 }}>
            ※ 생산일지 화면의 <b>「사진 찍어 스캔 입력」</b>에서도 바로 설정할 수 있으며, API 키 없이도 <b>사진 확대 대조 입력</b> 및 <b>샘플 스캔 시연</b>을 사용할 수 있습니다.
          </p>
        </Card>
      </div>

      <Card title="관리 기준값">
        <Notice kind="info">여기 값이 배합·일지·로트·공정표준서 화면의 경고와 판정에 그대로 쓰입니다. 변경은 감사 이력에 남습니다.</Notice>
        <div className="scroll">
          <table>
            <thead><tr><th>항목</th><th className="r">값</th><th>단위</th><th>근거</th></tr></thead>
            <tbody>
              {ROWS.map((r) => (
                <tr key={r.key}>
                  <td><b>{r.label}</b></td>
                  <td className="r"><Num value={db.settings[r.key] as number} onChange={(n) => set(r.key, n)} /></td>
                  <td>{r.unit}</td><td className="mute">{r.src}</td>
                </tr>
              ))}
              <tr>
                <td><b>LOT 접두 코드(현장)</b></td>
                <td className="r"><input style={{ width: 90, textAlign: 'right', fontWeight: 700 }} value={db.settings.siteCode} onChange={(e) => set('siteCode', e.target.value.toUpperCase())} /></td>
                <td></td><td className="mute">예: HYVN → HYVN261015-01</td>
              </tr>
            </tbody>
          </table>
        </div>
      </Card>

      <Card title={`공식 배포 센터 · 최신 파일 다운로드 (${APP_VERSION})`}>
        <p className="mute" style={{ marginBottom: 12 }}>
          본 시스템의 공식 배포 사이트, 단일 실행 파일(한국어/영문) 다운로드 및 최신 버전 릴리즈 노트를 확인합니다.
        </p>
        <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
          <a href="./portal.html" target="_blank" className="btn pri" style={{ textDecoration: 'none' }}>
            🌐 공식 배포 사이트 열기 (portal.html)
          </a>
          <a href="https://smc-manufacturing-system.vercel.app" target="_blank" className="btn" style={{ textDecoration: 'none', background: '#000', color: '#fff', border: '1px solid #444' }}>
            ▲ Vercel 클라우드 라이브 접속
          </a>
          <a href="./SMC_system.html" download="SMC_system.html" className="btn" style={{ textDecoration: 'none' }}>
            📥 한국어 단독 파일 다운로드 ({APP_VERSION})
          </a>
          <a href="./SMC_system_EN.html" download="SMC_system_EN.html" className="btn" style={{ textDecoration: 'none' }}>
            📥 English Edition Download ({APP_VERSION})
          </a>
          <a href="https://panic1190-eng.github.io/SMC_manufacturing_system/" target="_blank" className="btn" style={{ textDecoration: 'none' }}>
            ☁️ GitHub Pages 라이브 접속
          </a>
        </div>
      </Card>

      <Card title="데이터 백업·복원">
        <div className="row">
          <button className="btn pri" onClick={() => download(`smc-backup-${new Date().toISOString().slice(0, 10)}.json`, exportJSON())}>백업 파일 내려받기</button>
          <button className="btn" onClick={() => file.current?.click()}>백업 파일로 복원</button>
          <input ref={file} type="file" accept="application/json" hidden onChange={async (e) => {
            const f = e.target.files?.[0]
            if (!f) return
            try { importJSON(await f.text()) } catch (err) { alert((err as Error).message) }
            e.target.value = ''
          }} />
          <button className="btn dan" onClick={() => { if (confirm('모든 데이터를 초기 상태로 되돌립니다. 계속할까요?')) resetDB() }}>초기화</button>
        </div>
        <p className="mute">이 프로그램은 현재 이 브라우저에 데이터를 저장합니다(회사 로고 포함). 정기적으로 백업 파일을 내려받아 보관하세요.</p>
      </Card>

      <Card title="감사 이력 (최근 100건)">
        <div className="scroll">
          <table>
            <thead><tr><th>시각</th><th>작업자</th><th>작업</th><th>내용</th></tr></thead>
            <tbody>
              {db.audit.slice(0, 100).map((a, i) => (
                <tr key={i}><td>{a.at.slice(0, 19).replace('T', ' ')}</td><td>{a.user}</td><td><b>{a.action}</b></td><td className="mute">{a.detail}</td></tr>
              ))}
              {db.audit.length === 0 && <tr><td colSpan={4} className="mute">아직 기록된 감사 이력이 없습니다.</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  )
}

