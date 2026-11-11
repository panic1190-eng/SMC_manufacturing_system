import { Badge, Card, Notice } from '../ui'
import { update, uid, useDB } from '../store'
import { fmt, lotState, recipeName, statusLabel } from '../util'
import { computeSetting, glassFraction, pasteSG, recipeCostPerKg } from '../engine/calc'
import { APP_VERSION } from '../App'

export default function Dashboard() {
  const db = useDB()
  const stock = db.lots.filter((l) => !l.released)
  const states = stock.map((l) => ({ l, s: lotState(l, db.settings) }))
  const ready = states.filter((x) => x.s.state === '사용가능')
  const aging = states.filter((x) => x.s.state === '숙성중')
  const soon = states.filter((x) => x.s.state === '만료임박')
  const expired = states.filter((x) => x.s.state === '만료')
  const stockKg = stock.reduce((s, l) => s + l.netKg, 0)
  const totalKg = db.lots.reduce((s, l) => s + l.netKg, 0)
  const sinceBlade = Math.max(0, (totalKg - db.settings.bladeBaseKg) / 1000)
  const bladeRatio = Math.min(100, (sinceBlade / Math.max(1, db.settings.cutterBladeChangeTon)) * 100)
  const bladeDue = sinceBlade >= db.settings.cutterBladeChangeTon
  const draftRecipes = db.recipes.filter((r) => r.status === 'draft')
  const approvedRecipes = db.recipes.filter((r) => r.status === 'approved')
  const openRuns = db.runs.filter((r) => r.status === 'open')
  const openMix = db.mixOrders.filter((m) => m.status !== 'done')

  const loadSalesDemo = () => {
    const r = db.recipes.find((x) => x.family === '물탱크') ?? db.recipes[0]
    if (!r) return
    const p = db.products.find((x) => x.id === r.productId) ?? db.products[0]
    const sg = pasteSG(r.lines, db.materials)
    const gf = glassFraction(r.lines, db.materials)
    const setInput = {
      speed: 10,
      widthMm: p?.widthMm ?? 1100,
      arealKgM2: p?.arealKgM2 ?? 4.6,
      gf,
      bladeMm: db.machine.bladeMm,
      viscosityCps: db.machine.viscosityCps,
      pasteHeightMm: db.machine.pasteHeightMm,
      pasteSG: sg,
      tex: db.machine.tex,
      cutInch: db.machine.cutInch,
      cutters: db.machine.cutters,
      mgoShare: 0.0096,
      colorShare: 0.0137,
    }
    const setOut = computeSetting(setInput)
    const now = Date.now()
    const dayMs = 86400_000
    const settingId = uid('s')
    const mixId = uid('mo')
    const runId = uid('run')
    const todayStr = new Date().toISOString().slice(0, 10)
    const prodCode = p?.code ?? 'SMCSHEETWTR33'

    const matLots: Record<string, string> = {}
    const actualUse: Record<string, number> = {}
    r.lines.forEach((l) => {
      matLots[l.materialId] = `LOT-${l.materialId.toUpperCase()}-2610`
      actualUse[l.materialId] = l.materialId === 'glass' ? 1435.84 : Number(((l.phr / 70) * 350 * 2).toFixed(2))
    })

    update((d) => ({
      ...d,
      user: d.user || '김기술 수석',
      recipes: d.recipes.map((rec) =>
        rec.status === 'draft'
          ? { ...rec, status: 'approved', approvedBy: d.user || '김기술 수석', approvedAt: new Date().toISOString() }
          : rec,
      ),
      settingRuns: setOut
        ? [{ id: settingId, at: new Date().toISOString(), by: d.user || '김기술 수석', recipeId: r.id, input: setInput, output: setOut, engine: 'calc-v1.0' }, ...d.settingRuns]
        : d.settingRuns,
      mixOrders: [
        {
          id: mixId,
          no: `${d.settings.siteCode}-MIX-${todayStr.replace(/-/g, '').slice(2)}-01`,
          date: todayStr,
          recipeId: r.id,
          resinKg: 350,
          batches: 2,
          worker: '김길동 / 박말순',
          tempC: [24.5, 26.0, 28.5, 31.0, 38.2, 34.0],
          maxTempC: 38.2,
          maxRpm: 850,
          initViscPs: 120,
          initViscTempC: 32,
          status: 'done',
          note: '영업 시연용 표준 2배치 배합 완료 (최고 온도 38.2℃ 관리)',
          lines: r.lines
            .filter((l) => l.materialId !== 'glass')
            .map((l) => {
              const planKg = Number(((l.phr / 70) * 350 * 2).toFixed(2))
              return {
                materialId: l.materialId,
                planKg,
                actualKg: planKg,
                signedBy: '김길동',
                signedAt: new Date().toISOString(),
              }
            }),
        },
        ...d.mixOrders,
      ],
      runs: [
        {
          id: runId,
          date: todayStr,
          productCode: prodCode,
          lotNo: `${d.settings.siteCode}-WTG-${todayStr.replace(/-/g, '').slice(2)}-01`,
          mixOrderId: mixId,
          settingRunId: settingId,
          tempC: 25,
          humidity: 48,
          weather: '맑음',
          workers: 6,
          downtime: '생산준비 및 닥터박스 세척 25분',
          status: 'closed',
          matLots,
          actualUse,
          viscosity: [
            { label: '초기', ps: 120, tempC: 32 },
            { label: '5분', ps: 135, tempC: 33 },
            { label: '10분', ps: 210, tempC: 33 },
            { label: '15분', ps: 440, tempC: 33 },
            { label: '20분', ps: 520, tempC: 33 },
            { label: '25분', ps: 640, tempC: 31 },
          ],
          dischargeMeasured: { compound: 33.11, mgo: 325.6, color: 465.1 },
          glassLots: 'CPIC-2610A / WEIBO-2610B',
          glassRollKg: 14.95,
          preShip: { edge: 'ok', tack: 'ok', surface: 'ok', foreign: 'ok', pack: 'ok' },
          sampleGfPct: 33.0,
          targetArealKgM2: 4.6,
          targetWidthMm: 1100,
          targetThicknessMm: 3.0,
          rolls: [1, 2, 3, 4, 5, 6].map((no) => ({
            widthMm: 1100,
            speed: 10,
            db1: 1.655,
            db2: 1.655,
            cut1: 59.4,
            cut2: 59.4,
            arealKgM2: 4.6,
            thicknessMm: 3.0,
            impregPct: 98,
            grossKg: 765,
            netKg: 750,
            finalVisc: 450000,
            note: `${no}번 롤 정상 합격`,
          })),
          notes: '전 롤 외관·함침·점도 양호 (영업 시연 데이터)',
        },
        ...d.runs,
      ],
      lots: [
        {
          id: uid('lot'),
          lotNo: `${d.settings.siteCode}-WTG-261010-01`,
          runId,
          productCode: prodCode,
          producedAt: new Date(now - 5 * dayMs).toISOString(),
          gfPct: 33.0,
          netKg: 750,
          grossKg: 765,
          released: false,
          note: '숙성 완료 · 즉시 출고 가능 (1순위 FIFO)',
        },
        {
          id: uid('lot'),
          lotNo: `${d.settings.siteCode}-WTG-261012-02`,
          runId,
          productCode: prodCode,
          producedAt: new Date(now - 3 * dayMs).toISOString(),
          gfPct: 33.0,
          netKg: 750,
          grossKg: 765,
          released: false,
          note: '숙성 완료 · 출고 대기',
        },
        {
          id: uid('lot'),
          lotNo: `${d.settings.siteCode}-WTG-${todayStr.replace(/-/g, '').slice(2)}-03`,
          runId,
          productCode: prodCode,
          producedAt: new Date(now - 6 * 3600_000).toISOString(),
          gfPct: 33.0,
          netKg: 750,
          grossKg: 765,
          released: false,
          note: '항온 숙성실(35℃) 숙성 진행 중',
        },
        {
          id: uid('lot'),
          lotNo: `${d.settings.siteCode}-WTG-260825-01`,
          runId,
          productCode: prodCode,
          producedAt: new Date(now - 52 * dayMs).toISOString(),
          gfPct: 33.0,
          netKg: 680,
          grossKg: 695,
          released: false,
          note: '유효기한 만료 임박 로트 (우선 출고 알림 시연용)',
        },
        ...d.lots,
      ],
    }), { action: '영업 시연 데이터 생성', detail: '처방 일괄 승인 + 설정값 + 배합지시서 + 생산일지 + 숙성/출고 로트 4건 생성' })
  }

  return (
    <>
      <div className="doc-banner" style={{ marginBottom: 18 }}>
        <div className="doc-brand">
          {db.settings.companyLogo ? (
            <img src={db.settings.companyLogo} alt="회사 로고" className="doc-logo" />
          ) : (
            <div className="brand-mark" style={{ width: 46, height: 46, fontSize: 15 }}>SMC</div>
          )}
          <div>
            <div className="doc-sub">ENTERPRISE SMC MES & R&D SUITE · {db.settings.siteCode} PLANT · {APP_VERSION}</div>
            <h2 className="doc-title" style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <span>{db.settings.companyName || 'SMC 통합 기술·생산·품질관리 시스템'}</span>
              <span style={{ fontSize: 13, background: 'linear-gradient(135deg, #1d4ed8 0%, #2563eb 100%)', color: '#fff', border: '1px solid #60a5fa', padding: '2px 9px', borderRadius: 6, fontWeight: 800, letterSpacing: '0.02em', boxShadow: '0 2px 8px rgba(37,99,235,0.3)' }}>{APP_VERSION}</span>
            </h2>
          </div>
        </div>
        <div className="row">
          <button className="btn" style={{ background: 'rgba(255,255,255,0.12)', color: '#fff', borderColor: 'rgba(255,255,255,0.25)' }} onClick={() => { location.hash = 'std' }}>
            📘 공정표준서·매뉴얼 열람
          </button>
          <button className="btn" style={{ background: 'rgba(255,255,255,0.12)', color: '#fff', borderColor: 'rgba(255,255,255,0.25)' }} onClick={() => { location.hash = 'forms' }}>
            📋 작업일지·관리양식함
          </button>
          <button className="btn pri" onClick={loadSalesDemo}>
            🚀 영업 시연용 샘플 데이터 원클릭 생성
          </button>
        </div>
      </div>

      {/* 5-Step Manufacturing Flow Quick Launcher */}
      <Card title="SMC 스마트 공정 워크플로우 (클릭 시 해당 공정으로 즉시 이동)">
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 10 }}>
          {[
            { id: 'recipe', step: 'STEP 01', title: '제품·처방·원가', desc: `등록 처방 ${db.recipes.length}종 (승인 ${approvedRecipes.length}종)`, badge: '원가계산서 포함' },
            { id: 'setting', step: 'STEP 02', title: '설정값 계산기', desc: `D/B 갭 · 펌프 3계통 · 컷터 RPM`, badge: `이력 ${db.settingRuns.length}건` },
            { id: 'mix', step: 'STEP 03', title: '배합지시서', desc: `STEP 1~6 정밀 계량·서명`, badge: `진행 ${openMix.length}건` },
            { id: 'prod', step: 'STEP 04', title: '생산일지·스마트스캔', desc: `빈 양식 인쇄 · 사진 스캔(OCR)`, badge: `진행 ${openRuns.length}건` },
            { id: 'lot', step: 'STEP 05', title: '로트·숙성·라벨', desc: `FIFO 출고 통제 · 라벨 인쇄`, badge: `${stock.length}개 로트` },
          ].map((w) => (
            <div
              key={w.id}
              onClick={() => { location.hash = w.id }}
              style={{
                padding: '12px 14px',
                borderRadius: 10,
                border: '1px solid var(--line-strong)',
                background: 'linear-gradient(180deg, #ffffff 0%, #f8fafc 100%)',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
              }}
            >
              <div className="row" style={{ justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ fontSize: 11, fontWeight: 800, color: 'var(--accent)' }}>{w.step}</span>
                <Badge kind="info">{w.badge}</Badge>
              </div>
              <div style={{ fontWeight: 800, fontSize: 15, color: '#0f172a', marginBottom: 2 }}>{w.title}</div>
              <div className="mute" style={{ fontSize: 12 }}>{w.desc}</div>
            </div>
          ))}
        </div>
      </Card>

      <div className="grid g4" style={{ marginBottom: 14 }}>
        <div className="kpi hot">
          <b>{fmt(stockKg, 0)} kg</b>
          <span>현재 가용 재고 중량 (총 {stock.length}개 로트)</span>
        </div>
        <div className="kpi">
          <b style={{ color: 'var(--ok)' }}>{ready.length} 로트</b>
          <span>출고 가능 (숙성 {db.settings.matureMinH}h 완료 & 품질 합격)</span>
        </div>
        <div className="kpi">
          <b style={{ color: 'var(--warn)' }}>{aging.length} 로트</b>
          <span>항온 숙성실 숙성 진행 중 (30~40℃)</span>
        </div>
        <div className="kpi">
          <b>{openMix.length} / {openRuns.length} 건</b>
          <span>진행 중 배합지시서 / 작성 중 생산일지</span>
        </div>
      </div>

      {expired.length > 0 && <Notice kind="bad">사용기한이 지난 로트(출고 차단됨): {expired.map((x) => x.l.lotNo).join(', ')}</Notice>}
      {soon.length > 0 && <Notice kind="warn">사용기한 14일 이내 임박 로트(우선 출고 요망): {soon.map((x) => x.l.lotNo).join(', ')}</Notice>}
      {draftRecipes.length > 0 && (
        <Notice kind="info">
          미승인 초안 처방 {draftRecipes.length}건이 있습니다 ({draftRecipes.slice(0, 4).map((r) => r.family).join(', ')}{draftRecipes.length > 4 ? ' 외' : ''}). 상단 <b>「🚀 영업 시연용 샘플 데이터 원클릭 생성」</b>을 누르면 일괄 승인 및 샘플 생산 데이터가 채워집니다.
        </Notice>
      )}

      <div className="grid g2">
        <Card
          title="전 제품·처방 마스터 물성 및 원가 요약 (9종)"
          right={<button className="btn" onClick={() => { location.hash = 'recipe' }}>처방·원가 상세 →</button>}
        >
          <div className="scroll">
            <table>
              <thead>
                <tr>
                  <th>처방명</th>
                  <th>상태</th>
                  <th className="r">유리섬유</th>
                  <th className="r">페이스트 비중</th>
                  <th className="r">원재료비</th>
                  <th className="r">예상 총제조원가</th>
                </tr>
              </thead>
              <tbody>
                {db.recipes.map((r) => {
                  const gf = glassFraction(r.lines, db.materials)
                  const sg = pasteSG(r.lines, db.materials)
                  const rawCost = recipeCostPerKg(r.lines, db.materials)
                  const totalMfgCost = rawCost + 41.83 + 23.76 + 92.0
                  return (
                    <tr key={r.id}>
                      <td><b>{recipeName(r)}</b></td>
                      <td>
                        <Badge kind={r.status === 'approved' ? 'ok' : r.status === 'draft' ? 'warn' : 'mute'}>
                          {statusLabel[r.status]}
                        </Badge>
                      </td>
                      <td className="r">{fmt(gf * 100, 1)}%</td>
                      <td className="r">{fmt(sg, 3)}</td>
                      <td className="r">{fmt(rawCost, 0)} 원/kg</td>
                      <td className="r"><b>{fmt(totalMfgCost, 0)} 원/kg</b></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div className="mute" style={{ fontSize: 11.5, marginTop: 6 }}>
            ※ 예상 총제조원가 = 처방별 원재료비 + 부재료비(41.83원) + 노무비(23.76원) + 제조경비·감가비(92.00원) 합산 기준
          </div>
        </Card>

        <div>
          <Card
            title="설비 예방보전(PM) 및 커터 날 교체 주기 모니터"
            right={
              <button
                className="btn"
                disabled={totalKg === 0}
                onClick={() =>
                  update(
                    (d) => ({ ...d, settings: { ...d.settings, bladeBaseKg: totalKg } }),
                    { action: '커터 날 교체 기록', detail: `누적 ${fmt(totalKg / 1000, 1)}톤 시점` },
                  )
                }
              >
                교체 완료 기록
              </button>
            }
          >
            <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
              <span>교체 이후 누적 생산량: <b>{fmt(sinceBlade, 2)} 톤</b> / 기준 {db.settings.cutterBladeChangeTon} 톤</span>
              <Badge kind={bladeDue ? 'bad' : bladeRatio > 80 ? 'warn' : 'ok'}>
                {bladeDue ? '즉시 교체 필요' : bladeRatio > 80 ? '교체 임박' : '정상 가동 중'}
              </Badge>
            </div>
            <div style={{ height: 10, background: '#e2e8f0', borderRadius: 999, overflow: 'hidden', marginBottom: 10 }}>
              <div
                style={{
                  width: `${bladeRatio}%`,
                  height: '100%',
                  background: bladeDue ? '#dc2626' : bladeRatio > 80 ? '#d97706' : 'linear-gradient(90deg, #2563eb, #10b981)',
                  transition: 'width 0.3s ease',
                }}
              />
            </div>
            <table>
              <thead>
                <tr><th>핵심 설비 유닛</th><th>일일·정기 점검 핵심 기준</th><th>가이드</th></tr>
              </thead>
              <tbody>
                <tr>
                  <td><b>1. 닥터박스 (D/B)</b></td>
                  <td>황동·플라스틱 헤라 세척(철 헤라 금지), 수평 0.05mm 유지</td>
                  <td><button className="btn" onClick={() => { location.hash = 'std' }}>매뉴얼</button></td>
                </tr>
                <tr>
                  <td><b>2. 유리섬유 커팅날</b></td>
                  <td>{db.settings.cutterBladeChangeTon}톤 생산 또는 월 1회 정기 교체, 에어건 분진 제거</td>
                  <td><button className="btn" onClick={() => { location.hash = 'std' }}>매뉴얼</button></td>
                </tr>
                <tr>
                  <td><b>3. 3계통 계량 펌프</b></td>
                  <td>작업 전 토출량 실측 검증 (허용 오차 ±3% 이내 관리)</td>
                  <td><button className="btn" onClick={() => { location.hash = 'setting' }}>유량계산</button></td>
                </tr>
              </tbody>
            </table>
          </Card>

          <Card title="최근 작업 및 감사 로그 (Audit Trail)">
            <div className="scroll">
              <table>
                <thead>
                  <tr><th>일시</th><th>작업자</th><th>구분</th><th>상세 내역</th></tr>
                </thead>
                <tbody>
                  {db.audit.slice(0, 6).map((a, i) => (
                    <tr key={i}>
                      <td style={{ whiteSpace: 'nowrap' }}>{a.at.slice(5, 16).replace('T', ' ')}</td>
                      <td><b>{a.user}</b></td>
                      <td><Badge kind="info">{a.action}</Badge></td>
                      <td className="mute">{a.detail}</td>
                    </tr>
                  ))}
                  {db.audit.length === 0 && (
                    <tr>
                      <td colSpan={4} className="mute">
                        아직 작업 이력이 없습니다. 상단 「🚀 영업 시연용 샘플 데이터 원클릭 생성」 버튼을 눌러보세요.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      </div>
    </>
  )
}
