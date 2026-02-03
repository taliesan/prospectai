// Core types for the ProspectAI system

export interface ResearchResult {
  id: string;
  donorName: string;
  status: 'complete' | 'insufficient' | 'error';
  sourceCount: number;
  queries: QueryResult[];
  rawMarkdown: string;
  createdAt: string;
}

export interface QueryResult {
  query: string;
  category: string;
  results: SourceResult[];
}

export interface SourceResult {
  url: string;
  title: string;
  snippet: string;
  domain: string;
  content?: string; // Full content if fetched
}

// The 17 dimensions
export type DimensionId = 
  | 'IDENTITY_FORMATION'
  | 'BIO_CONTEXT'
  | 'CAREER_ARC'
  | 'WORLDVIEW_ENGINE'
  | 'POLITICS_PUBLIC_POSITIONS'
  | 'POWER_THEORY'
  | 'MEETING_DYNAMICS'
  | 'SOCIAL_PRESENCE'
  | 'RETREAT_PATTERNS'
  | 'NETWORK_DYNAMICS'
  | 'GIVING_HISTORY'
  | 'FUNDRAISING_ORIENTATION'
  | 'RISK_POSTURE'
  | 'CONTRADICTIONS'
  | 'SYSTEMS_FEAR'
  | 'IDIOSYNCRATIC_CUES'
  | 'LOGISTICAL_PREFERENCES';

export type SignalStrength = 'STRONG' | 'MEDIUM' | 'WEAK' | 'NONE';
export type Trajectory = 'INCREASING' | 'STABLE' | 'DECREASING' | 'UNKNOWN';
export type Salience = 'HOT' | 'WARM' | 'COOL' | 'UNKNOWN';
export type ContradictionStatus = 'ACTIVE' | 'RESOLVED';

export interface EvidenceItem {
  dimension: DimensionId;
  pattern: string;
  trigger?: string;
  response?: string;
  tell?: string;
  evidence: string;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  confidenceReason: string;
  meetingImplication: string;
  sourceUrl: string;
  sourceTitle: string;
}

export interface EvidenceOfAbsence {
  dimension: DimensionId;
  notableSilence: string;
  significance: string;
}

export interface DimensionSynthesis {
  dimension: DimensionId;
  summary: string;
  signalStrength: SignalStrength;
  trajectory?: Trajectory;
  salience?: Salience; // Only for dimensions 11-15
  patterns: PatternSynthesis[];
  contradictions: ContradictionSynthesis[];
  evidenceOfAbsence?: EvidenceOfAbsence;
  evidenceCount: number;
  sourceUrls: string[];
  meetingImplications: string[];
}

export interface PatternSynthesis {
  pattern: string;
  sourceCount: number;
  triggers: string[];
  responses: string[];
  tells: string[];
  supportingEvidence: { quote: string; sourceUrl: string }[];
}

export interface ContradictionSynthesis {
  statedValue: string;
  revealedBehavior: string;
  status: ContradictionStatus;
  navigationStrategy?: string;
  evidence: string[];
  implication: string;
}

export interface CrossCuttingAnalysis {
  coreContradiction: {
    statement: string;
    manifestations: { dimension: DimensionId; description: string }[];
    whyLoadBearing: string;
  };
  dangerousTruth: {
    fear: string;
    evidence: string[];
    howItShowsUp: string;
  };
  substrateArchitecture: {
    identityBoundary: string;
    worldviewCompression: string;
    incentiveThresholds: string;
    authorshipTolerance: string;
    exposureManagement: string;
  };
}

export interface Dossier {
  id: string;
  donorName: string;
  status: 'complete' | 'weak_signal' | 'error';
  confidenceLevel: 'HIGH' | 'MEDIUM' | 'LOW';
  dimensions: DimensionSynthesis[];
  crossCutting: CrossCuttingAnalysis;
  sourceBibliography: BibliographyEntry[];
  rawMarkdown: string;
  createdAt: string;
}

export interface BibliographyEntry {
  url: string;
  title: string;
  type: 'PERSONAL' | 'INTERVIEW' | 'PROFILE' | 'EMPLOYER' | 'NEWS' | 'SOCIAL' | 'DIRECTORY';
  quality: 'HIGH' | 'MEDIUM' | 'LOW';
  dimensionsCovered: DimensionId[];
  depthOverride?: boolean;
}

export interface Profile {
  id: string;
  donorName: string;
  status: 'complete' | 'validation_failed' | 'error';
  validationPasses: number;
  sections: ProfileSection[];
  rawMarkdown: string;
  createdAt: string;
}

export interface ProfileSection {
  number: number;
  title: string;
  content: string; // Markdown content
}

export interface ValidationResult {
  status: 'PASS' | 'FAIL';
  critique?: string;
  checks: {
    behavioralFocus: boolean;
    specificity: boolean;
    conditionalLogic: boolean;
    contradictionPresent: boolean;
    evidenceGrounding: boolean;
    actionability: boolean;
    canonCompliance: boolean;
  };
}

// API request/response types
export interface ResearchRequest {
  donorName: string;
  seedUrls?: string[];
}

export interface ExtractRequest {
  researchId: string;
  rawResearch: string;
}

export interface GenerateRequest {
  dossierId: string;
  dossier: string;
}

export interface ProfileOutput {
  research: ResearchResult;
  dossier: Dossier;
  profile: Profile;
}
