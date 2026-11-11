import { useEffect, useRef, useState, type ReactNode } from 'react'
import { update, useDB } from './store'
import { ENGINE_VERSION } from './engine/calc'
import { translateText, useDomTranslator, useLang } from './i18n'

export const APP_VERSION = 'v0.5.0'
import Dashboard from './pages/Dashboard'
import Materials from './pages/Materials'
import Recipes from './pages/Recipes'
import Setting from './pages/Setting'
import Mixing from './pages/Mixing'
import Production from './pages/Production'
import Lots from './pages/Lots'
import Forms from './pages/Forms'
import Standard from './pages/Standard'
import Rules, { fileToLogoDataUrl } from './pages/Rules'

interface PageItem {
  id: string
  name: string
  sub: string
  group: 'overview' | 'process' | 'docs' | 'system'
  step?: string
  icon: ReactNode
  C: () => JSX.Element
}

const PAGES: readonly PageItem[] = [
  {
    id: 'dash',
    name: '대시보드',
    sub: '생산·재고·설비 핵심 지표 및 실시간 공정 현황',
    group: 'overview',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="7" height="9" rx="1.5" />
        <rect x="14" y="3" width="7" height="5" rx="1.5" />
        <rect x="14" y="12" width="7" height="9" rx="1.5" />
        <rect x="3" y="16" width="7" height="5" rx="1.5" />
      </svg>
    ),
    C: Dashboard,
  },
  {
    id: 'recipe',
    name: '제품·처방·원가',
    sub: '엑셀 9종 전체 처방(phr) 마스터 관리 및 물탱크 배합 총 제조원가 계산서',
    group: 'process',
    step: '01',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
        <path d="M10 2v7.31" />
        <path d="M14 9.3V1.99" />
        <path d="M8.5 2h7" />
        <path d="M14 9.3a6.5 6.5 0 1 1-4 0" />
        <path d="M5.52 16h12.96" />
      </svg>
    ),
    C: Recipes,
  },
  {
    id: 'setting',
    name: '설정값 계산',
    sub: '닥터블레이드 갭, 3계통 펌프 유량, 컷터 RPM, 시편 중량 및 배합표 권장값 vs 실제값 비교',
    group: 'process',
    step: '02',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
        <line x1="4" y1="21" x2="4" y2="14" />
        <line x1="4" y1="10" x2="4" y2="3" />
        <line x1="12" y1="21" x2="12" y2="12" />
        <line x1="12" y1="8" x2="12" y2="3" />
        <line x1="20" y1="21" x2="20" y2="16" />
        <line x1="20" y1="12" x2="20" y2="3" />
        <line x1="1" y1="14" x2="7" y2="14" />
        <line x1="9" y1="8" x2="15" y2="8" />
        <line x1="17" y1="16" x2="23" y2="16" />
      </svg>
    ),
    C: Setting,
  },
  {
    id: 'mix',
    name: '배합지시서',
    sub: '배치별 원재료 환산, STEP 1~6 공정별 계량·서명 및 지시서 인쇄',
    group: 'process',
    step: '03',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" />
        <rect x="9" y="3" width="6" height="4" rx="1" />
        <path d="m9 14 2 2 4-4" />
      </svg>
    ),
    C: Mixing,
  },
  {
    id: 'prod',
    name: '생산일지 (스마트스캔)',
    sub: '점도 변화·토출량 검증·롤별 품질 판정 · 빈 양식 인쇄 및 사진 스캔(OCR) 자동 입력',
    group: 'process',
    step: '04',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
        <path d="M2 20a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8l-7 5V8l-7 5V4a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z" />
        <path d="M17 18h1" />
        <path d="M12 18h1" />
        <path d="M7 18h1" />
      </svg>
    ),
    C: Production,
  },
  {
    id: 'lot',
    name: '로트·재고·라벨',
    sub: '숙성 시간 및 유효기한 기반 선입선출(FIFO) 출고 관리·라벨 발행',
    group: 'process',
    step: '05',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" />
        <path d="m3.3 7 8.7 5 8.7-5" />
        <path d="M12 22V12" />
      </svg>
    ),
    C: Lots,
  },
  {
    id: 'std',
    name: '공정표준서·매뉴얼',
    sub: 'SMC 공정 표준서(SMC-STD-001) · 공정별 핵심 가이드 · 시트 관리 5대 수칙(한/베) · 기계 예방보전 가이드(한/베)',
    group: 'docs',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20" />
        <path d="M8 7h6" />
        <path d="M8 11h8" />
      </svg>
    ),
    C: Standard,
  },
  {
    id: 'forms',
    name: '작업일지·관리양식함',
    sub: '엑셀 원본 양식 그대로 인쇄·열람 (신규 14롤 일지 / 기존 17롤 일지 v4·0.5배치 / 배합지시서 40%·30% / 완제품 라벨)',
    group: 'docs',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
        <line x1="16" y1="13" x2="8" y2="13" />
        <line x1="16" y1="17" x2="8" y2="17" />
        <line x1="10" y1="9" x2="8" y2="9" />
      </svg>
    ),
    C: Forms,
  },
  {
    id: 'mat',
    name: '원재료 마스터',
    sub: '수지·첨가제·충진제·유리섬유 비중 및 단가 기준 정보 관리',
    group: 'system',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
        <ellipse cx="12" cy="5" rx="9" ry="3" />
        <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
        <path d="M3 12c0 1.66 4 3 9 3s9-1.34 9-3" />
      </svg>
    ),
    C: Materials,
  },
  {
    id: 'rule',
    name: '기준값·로고·이력',
    sub: '회사 로고 등록, 스마트 스캔 AI 설정, 공정 관리 기준값, 백업·복원 및 감사 로그',
    group: 'system',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
        <path d="m9 12 2 2 4-4" />
      </svg>
    ),
    C: Rules,
  },
] as const

const GROUP_LABELS: Record<PageItem['group'], string> = {
  overview: 'OVERVIEW',
  process: 'MANUFACTURING FLOW',
  docs: 'MANUALS & FORMS (엑셀 통합)',
  system: 'MASTER & GOVERNANCE',
}

export default function App() {
  const db = useDB()
  const [lang, setLang] = useLang()
  const appRef = useRef<HTMLDivElement>(null)
  const logoInputRef = useRef<HTMLInputElement>(null)
  const [page, setPage] = useState<string>(() => location.hash.slice(1) || 'dash')
  useEffect(() => {
    const onHash = () => {
      const h = location.hash.slice(1)
      if (h && PAGES.some((p) => p.id === h)) setPage(h)
    }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])
  useEffect(() => { location.hash = page }, [page])

  useDomTranslator(appRef, lang, page)

  const cur = PAGES.find((p) => p.id === page) ?? PAGES[0]
  const C = cur.C
  const hasUser = db.user.trim().length > 0
  const tx = (s: string) => (lang === 'en' ? translateText(s) : s)

  useEffect(() => {
    document.title = `${tx(cur.name)} — SMC 기술·생산관리 시스템 [${APP_VERSION}]`
  }, [cur, lang])

  return (
    <div className="app" ref={appRef}>
      <nav className="side">
        <div
          className="brand"
          onClick={() => logoInputRef.current?.click()}
          title={tx('클릭하여 회사 로고 이미지를 등록하거나 변경합니다')}
          style={{ cursor: 'pointer' }}
        >
          {db.settings.companyLogo ? (
            <img src={db.settings.companyLogo} alt="Logo" className="brand-logo-img" />
          ) : (
            <div className="brand-mark">SMC</div>
          )}
          <div className="brand-text">
            <h1 style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              <span>{tx(db.settings.companyName || 'SMC 기술·생산관리')}</span>
              <span style={{ fontSize: 10, background: '#1e40af', color: '#93c5fd', border: '1px solid #3b82f6', padding: '1px 5px', borderRadius: 4, fontWeight: 800 }}>{APP_VERSION}</span>
            </h1>
            <span>{tx(db.settings.companyLogo ? '로고 클릭 시 변경' : '+ 클릭하여 회사 로고 등록')}</span>
          </div>
          <input
            ref={logoInputRef}
            type="file"
            accept="image/*"
            hidden
            onChange={async (e) => {
              const f = e.target.files?.[0]
              if (!f) return
              try {
                const url = await fileToLogoDataUrl(f)
                update((d) => ({ ...d, settings: { ...d.settings, companyLogo: url } }), { action: '회사 로고 등록', detail: f.name })
              } catch (err) {
                alert((err as Error).message)
              }
              e.target.value = ''
            }}
          />
        </div>

        <div className="nav-scroll">
          {(['overview', 'process', 'docs', 'system'] as const).map((grp) => (
            <div key={grp} className="nav-group">
              <div className="nav-label">{tx(GROUP_LABELS[grp])}</div>
              {PAGES.filter((p) => p.group === grp).map((p) => (
                <button
                  key={p.id}
                  className={p.id === cur.id ? 'on' : ''}
                  onClick={() => setPage(p.id)}
                >
                  <span className="nav-ico">{p.icon}</span>
                  <span className="nav-name">{tx(p.name)}</span>
                  {p.step && <span className="nav-step">{p.step}</span>}
                </button>
              ))}
            </div>
          ))}
        </div>

        <div className="side-foot">
          <div className="side-foot-row">
            <span className="status-dot ok" />
            <span> {tx('로컬 DB 자동 저장 중')}</span>
          </div>
          <div className="side-foot-meta">
            <span>{db.settings.siteCode} SITE</span>
            <span>App {APP_VERSION} · {ENGINE_VERSION}</span>
          </div>
        </div>
      </nav>

      <main>
        <header className="top">
          <div className="top-title">
            <div className="top-crumb">
              <span>{tx(GROUP_LABELS[cur.group])}</span>
              {cur.step && <span className="top-step">STEP {cur.step}</span>}
            </div>
            <h2>{tx(cur.name)}</h2>
            <p className="top-sub">{tx(cur.sub)}</p>
          </div>
          <div className="top-actions">
            <a
              href="./portal.html"
              target="_blank"
              title={tx('공식 배포 센터 및 버전 릴리즈 노트 열기')}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 7,
                background: 'linear-gradient(135deg, #1d4ed8 0%, #2563eb 100%)',
                border: '1.5px solid #60a5fa',
                color: '#ffffff',
                padding: '5px 13px',
                borderRadius: 999,
                fontSize: 12.5,
                fontWeight: 800,
                textDecoration: 'none',
                letterSpacing: '0.02em',
                boxShadow: '0 2px 10px rgba(37, 99, 235, 0.45)',
              }}
            >
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#4ade80', boxShadow: '0 0 10px #4ade80' }} />
              <span>VERSION {APP_VERSION}</span>
            </a>
            <div className="seg-tabs" style={{ padding: 3, borderRadius: 999 }}>
              <button
                className={lang === 'ko' ? 'on' : ''}
                style={{ borderRadius: 999, padding: '5px 12px', fontSize: 12 }}
                onClick={() => setLang('ko')}
              >
                🇰🇷 한국어
              </button>
              <button
                className={lang === 'en' ? 'on' : ''}
                style={{ borderRadius: 999, padding: '5px 12px', fontSize: 12 }}
                onClick={() => setLang('en')}
              >
                🇺🇸 English
              </button>
            </div>
            <div className={`user-pill ${hasUser ? 'active' : 'empty'}`}>
              <span className="user-dot" />
              <span className="user-lbl">{tx('작업자')}</span>
              <input
                style={{ width: 120 }}
                placeholder={tx('성명 입력 (필수)')}
                value={db.user}
                onChange={(e) => update((d) => ({ ...d, user: e.target.value }))}
              />
            </div>
          </div>
        </header>
        <div className="page-body">
          <C />
        </div>
      </main>
    </div>
  )
}
