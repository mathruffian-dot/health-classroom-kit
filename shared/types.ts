export type Role = 'teacher' | 'student';
export interface User {
  id: string;
  role: Role;
  name: string;
  classId?: string;
  seat?: number;
}
export interface Activity {
  id: string;
  type: 'single' | 'multiple' | 'scale' | 'short';
  prompt: string;
  options?: string[];
  correct?: number[];
  min?: number;
  max?: number;
  minLabel?: string;
  maxLabel?: string;
  explanation?: string;
  sensitive?: boolean;
  aiAllowed?: boolean;
}
export interface Slide {
  id: string;
  title: string;
  eyebrow?: string;
  body: string;
  bullets?: string[];
  visual?: 'balance' | 'steps' | 'cards' | 'bars';
  activity?: Activity;
  notes?: string;
  source?: string;
  customHtml?: string;
}
export interface Lesson {
  schemaVersion: 1;
  id: string;
  title: string;
  description: string;
  subject: string;
  duration: number;
  objectives: string[];
  slides: Slide[];
  updatedAt?: string;
}
export interface Classroom {
  id: string;
  name: string;
  code: string;
  seats: number;
  createdAt: string;
}
export interface Credential {
  seat: number;
  code: string;
}
export interface Answer {
  id: string;
  submissionId: string;
  userId: string;
  seat: number;
  activityId: string;
  value: string | number | number[];
  submittedAt: string;
}
export interface Point {
  x: number;
  y: number;
}
export interface Stroke {
  id: string;
  color: string;
  width: number;
  points: Point[];
}
export interface Session {
  id: string;
  classId: string;
  className: string;
  lessonId: string;
  title: string;
  createdAt: string;
  ended: boolean;
  slideIndex: number;
  activityOpen: boolean;
  resultsVisible: boolean;
  followTeacher: boolean;
  buzzOpen: boolean;
  buzzWinner: { seat: number; at: string } | null;
  drawnSeat: number | null;
  drawnSeats: number[];
  revision: number;
}
export interface SessionView {
  session: Session;
  lesson: Lesson;
  answers: Answer[];
  aggregate: { counts: Record<string, number>; submitted: number; total: number };
  whiteboard: Record<string, Stroke[]>;
  roster?: { seat: number; lastSeen?: string }[];
}
export interface Dashboard {
  lessons: Lesson[];
  classes: Classroom[];
  sessions: Session[];
}
export interface AppConfig {
  mode: 'demo' | 'supabase';
  aiConfigured: boolean;
  version: string;
}
