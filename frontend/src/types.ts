// Types mirroring the CLEARPATH backend payloads (clearpath/main.py, agent/orchestrator.py,
// decision/engine.py, agent/perception.py). Fields the backend may omit are optional.

export type Vec2 = [number, number];

// ---------------------------------------------------------------- /api/status
export interface OpenCVInfo {
  version?: string;
  version_control?: string;
  platform?: string;
  cpu_baseline?: string;
  cpu_dispatched?: string;
  parallel_framework?: string;
  threads?: number;
  [k: string]: unknown;
}

export interface CoolInfo {
  state?: string;
  marker?: string | null;
  note?: string;
}

export interface VisionStatus {
  mode?: string | null;
  endpoint?: string | null;
  reachable?: boolean | null;
  latency_ms?: number | null;
  error?: string | null;
  machine?: string | null;
  arm64?: boolean | null;
  on_aws?: boolean | null;
  graviton?: boolean | null;
  ec2?: Record<string, unknown> | string | null;
  opencv?: OpenCVInfo | null;
  cool?: CoolInfo | null;
  counters?: { analyses?: number; errors?: number; total_ms?: number } | null;
}

export interface AwsStatus {
  checked_at?: number;
  region?: string | null;
  boto3?: boolean;
  s3_bucket?: string | null;
  cloudwatch?: boolean;
  connected?: boolean;
  reason?: string | null;
}

export interface Status {
  simulation: boolean;
  vision: VisionStatus;
  aws: AwsStatus;
  detector: { model: string; weapon_model: string | null };
}

// ---------------------------------------------------------------- /api/building
export interface Zone {
  id: string;
  name: string;
  kind: string;
  capacity?: number;
  polygon: Vec2[];
  centroid: Vec2;
  area_m2?: number;
}

export interface Exit {
  id: string;
  name: string;
  zone: string;
  position: Vec2;
  width_m: number;
}

export interface Door {
  id: string;
  a: string;
  b: string;
  position: Vec2;
  width_m: number;
  kind: string;
}

export interface Camera {
  id: string;
  name: string;
  zone: string;
  position: Vec2;
  covers: string[];
  image_right_heading_deg: number;
  yaw_deg: number;
}

export interface ValidationIssue {
  severity: 'error' | 'warning' | 'info' | string;
  code: string;
  message: string;
  subject?: string;
}

export interface Building {
  name: string;
  units: string;
  constraints: Record<string, number | string>;
  zones: Zone[];
  exits: Exit[];
  doors: Door[];
  cameras: Camera[];
  bounds: [number, number, number, number];
  validation: ValidationIssue[];
}

// ---------------------------------------------------------------- /api/scenarios, /api/footage
export interface Trigger {
  source: string;
  claim: string;
  zone: string;
  confidence: number;
}

export interface Scenario {
  id: string;
  title: string;
  summary: string;
  trigger: Trigger;
  cameras: Record<string, string>;
  expected?: { primary_option?: string; threat_region?: string[] | null };
}

export interface ScenariosResponse {
  _note?: string;
  clips?: Record<string, Record<string, unknown>>;
  scenarios: Scenario[];
}

export interface FootageClip {
  file?: string;
  synthetic?: boolean;
  source?: string;
  spec?: Record<string, unknown>;
  ground_truth?: Record<string, unknown>;
}

export interface FootageResponse {
  clips: Record<string, FootageClip>;
  uploads: string[];
}

// ---------------------------------------------------------------- run state
export type RunStatus = 'running' | 'awaiting_review' | 'complete' | 'cancelled' | 'error';
export type Phase = 'INITIALIZING' | 'PERCEIVE' | 'DECIDE' | 'VALIDATE' | 'ACT' | 'REVIEW' | 'ARCHIVE' | 'ERROR';
export type CameraStatus = 'idle' | 'analyzing' | 'analyzed' | 'pending_recheck' | 'fault';
export type Activity = 'flight' | 'agitated' | 'calm' | 'congested' | 'empty' | 'unusable';

export interface ServiceInfo {
  machine?: string;
  arm64?: boolean;
  on_aws?: boolean;
  instance_type?: string | null;
  opencv_version?: string;
  cool?: string;
  wall_ms?: number;
}

export interface ToolCall {
  name: string;
  args: Record<string, unknown>;
  duration_ms: number;
  result?: string;
  service?: ServiceInfo;
}

export interface TraceEntry {
  step: number;
  t: number;
  phase: Phase | string;
  kind: string;
  title: string;
  detail: string;
  reason: string;
  tool: ToolCall | null;
  changes: string[];
  data: { analysis_id?: string; camera_id?: string; [k: string]: unknown };
}

export interface WeaponLike {
  cls: string;
  score: number;
  box?: number[];
  frame: number;
  kind?: string;
  source?: string;
}

export interface Evidence {
  camera_id: string;
  zone: string;
  activity: Activity;
  activity_label?: string;
  reliability: number;
  persons: number;
  persons_max: number;
  speed_bh_s: number | null;
  flow_speed_bh_s: number | null;
  running_fraction: number;
  coherence: number;
  flight_heading_deg: number | null;
  source_heading_deg: number | null;
  weapon_like: WeaponLike[];
  issues: string[];
  consistency: { checked: boolean; speed_ratio?: number; direction_gap_deg?: number | null; consistent?: boolean };
  enhanced: boolean;
  analysis_id: string | null;
}

export interface CameraState {
  id: string;
  zone: string;
  clip: string | null;
  status: CameraStatus;
  activity: Activity | null;
  reliability: number | null;
  analysis_id: string | null;
  evidence?: Evidence;
}

export interface ZoneState {
  id: string;
  observed: string;
  p_threat: number;
  persons: number | null;
  last_camera: string | null;
  status: string;
}

export interface BeliefSummary {
  p_threat: number;
  p_none: number;
  zones: Record<string, number>;
  conditional: Record<string, number>;
  region: string[];
  region_mass: number;
  localized: boolean;
  entropy: number;
  supporting_observations: number;
}

export interface BeliefPoint {
  step: number;
  p_threat: number;
  region_mass: number;
  entropy: number;
}

export interface RouteOperational {
  hazard_exposure: number;
  verified_fraction: number;
  verified_zones: string[];
  unverified_zones: string[];
  congested_zones: string[];
  faulted_zones: string[];
}

export type RouteStatus = 'verified_clear' | 'unverified' | 'congested' | 'exposed' | 'invalid' | 'no_route';

export interface Route {
  id: string;
  from: string;
  exit: string | null;
  path: string[];
  length_m?: number;
  math_valid: boolean;
  math_checks: Partial<Record<'connected' | 'avoids_exclusion_zone' | 'door_widths_ok' | 'travel_distance_ok', boolean>>;
  operational?: RouteOperational;
  operational_status: RouteStatus | string;
  safe: boolean;
  reason?: string;
  alternatives?: { exit: string; status: string; length_m: number }[];
}

export interface Routing {
  hazard_zones: string[];
  exclusion_zones: string[];
  blocked_exits: string[];
  lockdown_spaces: string[];
  routes: Route[];
}

export interface Precondition {
  check: string;
  pass: boolean;
  detail: string;
}

export interface ResponseOption {
  id: string;
  description: string;
  preconditions: Precondition[];
  feasible: boolean;
  rejected_by_reviewer: boolean;
  score: number;
  raw_score: number;
  actions: string[];
  risks: string[];
  spaces: Record<string, string[]>;
  routes: string[];
  requires_human_approval: boolean;
}

export interface Assessment {
  options: ResponseOption[];
  recommended: string;
  uncertainty: string[];
  why_not_full_evacuation: string[];
}

export interface Gap {
  camera_id: string;
  zone: string;
  issues: string[];
  reason: string;
}

export interface VerificationTask {
  camera_id: string;
  zone: string;
  priority: 'high' | 'medium' | 'low' | string;
  task: string;
  analysis_id?: string;
}

export interface ReviewRequest {
  requested_at: number;
  recommended: string;
  uncertainty: string[];
  gaps: Gap[];
  verification_tasks: VerificationTask[];
  allowed_actions: ReviewAction[];
}

export type ReviewAction = 'approve' | 'reject' | 'more_evidence' | 'block_exit';

export interface ReviewHistoryEntry {
  action?: ReviewAction;
  option_id?: string | null;
  exit_id?: string | null;
  note?: string;
  reviewer?: string;
  at: number;
  recommended: string;
}

export interface Detection {
  cls: string;
  score: number;
  box: [number, number, number, number];
  source?: string;
  track?: number | null;
}

export interface FrameRecord {
  index: number;
  detections: Detection[];
  detected: boolean;
  fg_ratio?: number;
}

export interface Analysis {
  analysis_id: string;
  camera_id: string;
  clip_id: string | null;
  frames_analyzed?: number;
  fps?: number;
  frame_size?: [number, number];
  preview_width?: number;
  params?: { enhance: string; detect_every: number; conf?: number };
  quality?: {
    brightness?: number;
    contrast?: number;
    sharpness?: number;
    haze?: number;
    frozen_ratio?: number;
    obstructed_ratio?: number;
    issues: string[];
    reliability: number;
  };
  persons?: { count_median: number; count_max: number; mean_score?: number; median_height_px?: number; tracks: number };
  motion?: {
    fg_ratio?: number;
    speed_bh_s_median: number | null;
    speed_bh_s_flow: number | null;
    running_fraction: number;
    direction_image_deg: number | null;
    flow_direction_image_deg?: number | null;
    coherence: number;
    track_vectors?: number[][];
  };
  weapon_like?: WeaponLike[];
  weapon_model?: string | null;
  detector?: { model?: string; file?: string; inferences?: number };
  timings?: Record<string, number>;
  per_frame?: FrameRecord[];
  frame_urls: string[];
  service?: ServiceInfo;
  synthetic: boolean;
  footage_source?: string;
}

export interface RunMetrics {
  vision_calls: number;
  vision_ms: number;
  reanalyses: number;
  faults: number;
}

export interface RunState {
  run_id: string;
  scenario: Pick<Scenario, 'id' | 'title' | 'summary' | 'trigger' | 'expected'>;
  camera_clips: Record<string, string>;
  status: RunStatus;
  phase: Phase | string;
  step: number;
  started_at: number;
  finished_at: number | null;
  simulation: boolean;
  trace: TraceEntry[];
  cameras: Record<string, CameraState>;
  zones: Record<string, ZoneState>;
  belief: BeliefSummary | null;
  belief_history: BeliefPoint[];
  routing: Routing | null;
  assessment: Assessment | null;
  review: ReviewRequest | null;
  review_history: ReviewHistoryEntry[];
  analyses: Record<string, Analysis>;
  gaps: Gap[];
  verification_tasks: VerificationTask[];
  action_log: string[];
  metrics: RunMetrics;
  error: string | null;
  approved_option?: string;
}

export interface ReviewBody {
  action: ReviewAction;
  option_id?: string;
  exit_id?: string;
  note: string;
  reviewer: string;
}
