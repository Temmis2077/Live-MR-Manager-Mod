# 🎛️ Live MR Manager — Mod

> **[AutumnColor77/Live-MR-Manager](https://github.com/AutumnColor77/Live-MR-Manager)의 개조(모드) 레포지토리입니다.**
> 원본 프로젝트에 **AI 가사 자동 정렬·싱크** 중심의 기능을 얹어 개발하고, 완성된 기능은 PR로 원본에 기여하는 것을 목표로 합니다.

[![Upstream](https://img.shields.io/badge/Upstream-AutumnColor77%2FLive--MR--Manager-24292f?style=for-the-badge&logo=github)](https://github.com/AutumnColor77/Live-MR-Manager)
[![Tauri 2.0](https://img.shields.io/badge/Tauri_2.0-FFC131?style=for-the-badge&logo=tauri&logoColor=white)](https://tauri.app/)
[![Rust](https://img.shields.io/badge/Rust-000000?style=for-the-badge&logo=rust&logoColor=white)](https://www.rust-lang.org/)
[![ONNX Runtime](https://img.shields.io/badge/ONNX_Runtime-005BA1?style=for-the-badge&logo=onnx&logoColor=white)](https://onnxruntime.ai/)

**Live MR Manager**는 실시간 방송·공연 환경을 위한 로컬 구동형 AI 음원 분리·오디오 제어 데스크톱 앱입니다(원본 프로젝트 소개는 [업스트림 README](https://github.com/AutumnColor77/Live-MR-Manager#readme) 참고). 이 레포는 그 위에 **가사 싱크 자동화**를 중심으로 한 확장 기능을 개발하는 공간입니다.

---

## 🎯 이 레포의 목표

1. **AI 가사 자동 정렬(Forced Alignment)을 실전 수준으로** — 가사를 붙여넣으면 AI가 오디오에 맞춰 타임스탬프 초안을 잡고, 사용자는 다듬기만 하면 되는 워크플로우.
2. **다국어 가사 대응** — 한국어뿐 아니라 영어(팝송), 한·영 혼합(랩/힙합), 일본어(원문/차음/번역 3줄) 가사까지.
3. **뮤직비디오 음원 실사용 편의** — MV 인트로 자동 감지, 간주/보컬 시작 구분, 재생 시 인트로 자동 건너뛰기.
4. **검증된 기능은 원본으로** — 완성도가 확인된 기능은 PR로 원 개발자에게 제안해 본가에 반영.

## ✨ 이 모드에서 추가된 주요 기능

### 🤖 AI 가사 자동 정렬 (핵심)

- **CTC 강제정렬 엔진** (Rust + ONNX Runtime): wav2vec2 음성인식 모델로 가사 줄별 타임스탬프 자동 배치. 분리된 **보컬 스템을 우선 사용**해 정확도 확보.
- **정렬 언어 선택**: 한국어 / English / **랩·혼합(한+영)** — 랩 모드는 두 모델을 모두 돌려 줄마다 우세 언어 결과를 채택.
- **정렬 모델 인앱 다운로드**: 한국어(~1.2GB)·영어(~360MB) 모델을 전용 GitHub Release에서 받아 설치. 모두 Apache-2.0.
- **정렬 대기열**: 라이브러리에서 여러 곡을 선택해 일괄 정렬. AI 프로세싱 탭에서 진행률·취소 관리.
- **글자 필터**: 문장부호·숫자·특수기호가 섞인 가사도 자동 정제 후 정렬.

### 📝 가사 싱크 편집기 확장

- **3줄(원문/차음/번역) 가사 모드**: 일본어 곡 등에서 원문·한글 발음·번역을 한 소절로 묶어 관리, 표시 항목은 인앱/오버레이별 독립 토글.
- **보컬 시작·간주 마커**: 수동 지정 + 파형 자동 감지 + **AI 정렬 첫 줄 기반 MV 인트로 감지**(원클릭 적용).
- **인트로 자동 건너뛰기**: 재생 시 마커 기준으로 MV 인트로를 건너뛰되, 간주(전주)가 마킹돼 있으면 음악 시작부터 재생.
- **BPM 그리드 러프 배치**, 가사 싱크 상태(싱크 완료/미싱크/가사 없음) 분류·필터.

### 🔧 편의 기능

- **MR 분리 방식 선택**: 곡마다 빠른 분리/고품질 분리(모델) 선택, 곡별 사용 모델 자동 기록.
- **MR 캐시 위치 설정**: 네트워크 공유 폴더 지정으로 여러 PC가 분리 결과 공유(고성능 PC에서 분리 → 방송 PC에서 재생).
- **플레이어 컨트롤바 빠른 메뉴(⋮)**: 현재 곡 정보 수정·MR 분리·가사 싱크 열기.
- **Meloming 가사 자동 시드**, 가사 링크 노출 등.

## 🚧 진행 중 / 예정

- [ ] 곡 추가 전용 UI — 등록 시 곡 정보·분리·가사·싱크를 원스톱으로 설정
- [ ] 영어→한글 발음 치환(한 줄 안 한·영 혼합 정밀 정렬) — 조사 완료, 보류 중
- [ ] 원본 프로젝트 PR 리뷰 대응 및 병합

전체 로드맵과 완료 항목은 [ToDo.md](ToDo.md) 참고.

## 🔀 원본과의 관계

- **원본(업스트림)**: [AutumnColor77/Live-MR-Manager](https://github.com/AutumnColor77/Live-MR-Manager) — 앱의 본체. 오디오 엔진, AI 분리, 라이브러리, OBS 오버레이 등 핵심은 모두 원본의 것입니다.
- **이 레포(모드)**: 위 추가 기능의 개발·실험 공간. 기능 브랜치에서 개발 후 원본에 Draft PR로 제안합니다.
- **버전**: 앱 버전 매니페스트는 원본 기준을 유지합니다(개조판 자체 버전 없음 — 버전 확정은 원 개발자 몫).
- **AI 정렬 모델 배포**: 앱 릴리즈와 분리된 전용 Release 태그(`ai-align-model-v1`, `align-model-en-v1`)로 호스팅.

## 🏃 개발 환경 구축

### 사전 요구 사항

- **Windows 10/11** (릴리스·개발 타깃은 Windows 전용)
- [Rust](https://www.rust-lang.org/tools/install) (rustup + stable toolchain)
- [Node.js](https://nodejs.org/) (LTS, v18+)
- [LLVM](https://releases.llvm.org/) 또는 `winget install LLVM.LLVM` — `signalsmith-stretch` 빌드 시 **libclang** 필요 (`LIBCLANG_PATH` → `...\LLVM\bin`)
- [C++ Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) — 네이티브 크레이트 및 Tauri 빌드용 (**「C++를 사용한 데스크톱 개발」** 워크로드 권장)

### 프로젝트 시작

```bash
# 의존성 설치
npm install

# Tauri 개발 모드 실행
npm run tauri dev

# 프론트엔드 테스트
npx vitest run

# Rust 테스트 (정렬 엔진 등)
cd src-tauri && cargo test --lib
```

**Windows PowerShell 참고**

- `npm`이 인식되지 않으면: 터미널을 새로 열거나 `npm.cmd` 사용
- `npm.ps1` 실행 정책 오류 시: `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` 또는 `npm.cmd run tauri dev`
- MR/AI 캐시 데이터: `%LOCALAPPDATA%\com.autumncolor77.live-mr-manager\`

## 📄 라이선스·크레딧

- 원본 프로젝트: [AutumnColor77/Live-MR-Manager](https://github.com/AutumnColor77/Live-MR-Manager) — 모든 핵심 설계와 구현의 저작권은 원 개발자에게 있습니다.
- AI 정렬 모델: [kresnik/wav2vec2-large-xlsr-korean](https://huggingface.co/kresnik/wav2vec2-large-xlsr-korean), [facebook/wav2vec2-base-960h](https://huggingface.co/facebook/wav2vec2-base-960h) — 둘 다 Apache-2.0.
