![Prometheus Main](Prometheus-MAIN.png)

<div align="center">

# Prometheus-MCP

### Creative Director MCP

**AI Creative Director that turns ordinary model output into expert-level work.**

[한국어](#한국어) | [English](#english)

</div>

---

## 한국어

Prometheus-MCP는 Claude, GPT, DeepSeek, MiniMax, Qwen, GLM 및 미래 모델이 생성한 크리에이티브 산출물을 전문가 수준으로 끌어올리는 Model Context Protocol 서버입니다. 단순한 문서 검색 시스템이 아니라, 생성 - 평가 - 개선 - 재생성 루프를 통해 품질을 지속적으로 향상시키는 AI Creative Director입니다.

### 대상 분야

- 웹 디자인 / UI 디자인 / UX 디자인
- Three.js / React Three Fiber
- VFX / 인터랙티브 경험
- 프론트엔드 애니메이션 / 크리에이티브 코딩
- 게임 개발

### 핵심 가치

1. 전문가 패턴 라이브러리 - 12개 패턴 카테고리, 확장 가능한 구조
2. Critic Engine - 14개 품질 차원, 37개 규칙, 증거 기반 평가
3. 자동 개선 루프 - 목표 점수 도달까지 반복
4. 품질 인텔리전스 - 감사 가능한 점수 근거
5. AI 크리에이티브 디렉팅 - 패턴 선택, 개선 전략, 재생성

### 아키텍처

```
사용자 요청
  -> Planner
  -> Knowledge Collector
  -> Pattern Selector
  -> Prompt Enhancer
  -> Generation Provider
  -> Evidence Collector
  -> Critic Engine
  -> Quality Scoring
  -> Improvement Engine
  -> Regeneration Loop
  -> 최종 결과
```

### 모듈

| 모듈 | 역할 |
|------|------|
| planner | 도메인 탐지, 브리프 생성, 종료 정책 |
| knowledge | 외부 지식 수집 + 프롬프트 인젝션 방어 |
| patterns | 패턴 검증, 저장소, 가중치 기반 선택 |
| critic | 증거 수집(결정적 측정) + 규칙 평가 + 점수 + 감사 가능 근거 |
| improver | 부분/전체 재생성 전략, 수정 프롬프트 |
| loop_controller | 상태 머신 + 종료 정책(목표/최대반복/비용/시간/수익체감) |
| providers | 역량 기반 라우터 (Stub, OpenAI 호환, Claude) |
| memory | 세션 간 학습, 효과성 추적 |
| history | 세션 내 타임라인 |
| telemetry | 구조화 로그, 메트릭, 비용, 트레이싱, 비밀 마스킹 |
| infrastructure | 설정, 캐시, 보안 |
| mcp | 7 tools / 5 resources / 4 prompts |

### MCP 도구

| 도구 | 설명 |
|------|------|
| direct_creative_work | 브리프에서 생성-평가-개선 루프 실행 |
| critique_artifact | 산출물 평가 (점수, 강점, 약점, 제안) |
| improve_artifact | 평가 기반 개선 계획 + 수정 프롬프트 |
| list_patterns | 패턴 목록 조회 |
| get_pattern | 패턴 상세 조회 |
| recall_sessions | 과거 세션 조회 |
| get_quality_trends | 품질 추세 분석 |

### 설치 및 실행

```bash
npm install
npm run build
npm start
```

### 테스트

```bash
npm test
```

### 설정

환경 변수로 런타임 설정을 덮어쓸 수 있습니다.

| 변수 | 설명 |
|------|------|
| PROMETHEUS_TARGET_SCORE | 목표 품질 점수 (기본 85) |
| PROMETHEUS_MAX_ITERATIONS | 최대 개선 반복 (기본 5) |
| PROMETHEUS_MAX_COST_USD | 비용 상한 (USD) |
| PROMETHEUS_DEFAULT_PROVIDER | 기본 모델 제공자 |
| PROMETHEUS_ENABLE_LLM_REASONING | LLM 추론 평가 활성화 |
| PROMETHEUS_ALLOW_COMMUNITY_PATTERNS | 커뮤니티 패턴 허용 |

모델 제공자 API 키는 해당 환경 변수(`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `DEEPSEEK_API_KEY` 등)가 존재하면 자동 활성화됩니다.

### 기술 스택

- TypeScript (ES Modules)
- Node.js 20+
- @modelcontextprotocol/sdk 1.29.0 (안정版)
- zod v3 / ajv
- Vitest

### 라이선스

MIT

---

## English

Prometheus-MCP is a Model Context Protocol server that elevates creative output from Claude, GPT, DeepSeek, MiniMax, Qwen, GLM, and future models to expert-level quality. It is not a document retrieval system. It is an AI Creative Director that runs a generate - critique - improve - regenerate loop to continuously raise quality.

### Target Domains

- Web design / UI design / UX design
- Three.js / React Three Fiber
- VFX / interactive experiences
- Frontend animation / creative coding
- Game development

### Core Value

1. Expert Pattern Library - 12 pattern categories, extensible structure
2. Critic Engine - 14 quality dimensions, 37 rules, evidence-bound evaluation
3. Auto Improvement Loop - iterates until target score is reached
4. Quality Intelligence - auditable score justifications
5. AI Creative Directing - pattern selection, improvement strategy, regeneration

### Architecture

```
User request
  -> Planner
  -> Knowledge Collector
  -> Pattern Selector
  -> Prompt Enhancer
  -> Generation Provider
  -> Evidence Collector
  -> Critic Engine
  -> Quality Scoring
  -> Improvement Engine
  -> Regeneration Loop
  -> Final result
```

### Modules

| Module | Responsibility |
|--------|----------------|
| planner | domain detection, brief formation, termination policy |
| knowledge | external knowledge collection + prompt injection defense |
| patterns | pattern validation, repository, weighted selection |
| critic | evidence collection (deterministic measurement) + rule evaluation + scoring + auditable justification |
| improver | surgical/full regeneration strategy, revision prompts |
| loop_controller | state machine + termination policy (target/maxIter/cost/wallClock/diminishing returns) |
| providers | capability-based router (Stub, OpenAI-compatible, Claude) |
| memory | cross-session learning, effectiveness tracking |
| history | intra-session timeline |
| telemetry | structured logs, metrics, cost, tracing, secret redaction |
| infrastructure | config, cache, security |
| mcp | 7 tools / 5 resources / 4 prompts |

### MCP Tools

| Tool | Description |
|------|-------------|
| direct_creative_work | runs generate-critique-improve loop from a brief |
| critique_artifact | evaluates an artifact (score, strengths, weaknesses, suggestions) |
| improve_artifact | builds improvement plan + revision prompt from a critique |
| list_patterns | lists available patterns |
| get_pattern | gets pattern detail |
| recall_sessions | recalls past sessions |
| get_quality_trends | analyzes quality trends |

### Install and Run

```bash
npm install
npm run build
npm start
```

### Tests

```bash
npm test
```

### Configuration

Environment variables override runtime config.

| Variable | Description |
|----------|-------------|
| PROMETHEUS_TARGET_SCORE | target quality score (default 85) |
| PROMETHEUS_MAX_ITERATIONS | max improvement iterations (default 5) |
| PROMETHEUS_MAX_COST_USD | cost cap (USD) |
| PROMETHEUS_DEFAULT_PROVIDER | default model provider |
| PROMETHEUS_ENABLE_LLM_REASONING | enable LLM reasoning in critique |
| PROMETHEUS_ALLOW_COMMUNITY_PATTERNS | allow community-trust patterns |

Model provider API keys auto-enable their providers when the corresponding env var (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `DEEPSEEK_API_KEY`, etc.) is present.

### Tech Stack

- TypeScript (ES Modules)
- Node.js 20+
- @modelcontextprotocol/sdk 1.29.0 (stable)
- zod v3 / ajv
- Vitest

### License

MIT
