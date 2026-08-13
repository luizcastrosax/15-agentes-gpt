export type ID = string;

export type Role = "admin" | "staff" | "viewer";

export interface User {
  id: ID;
  name: string;
  email: string;
  role: Role;
  passwordHash: string;
  active: boolean;
  createdAt: string;
}

export interface Org {
  name: string;
  tagline: string;
  email: string;
  phone: string;
  website: string;
  primaryColor: string;
  currency: string;
  logoText: string;
}

export interface Stage {
  id: ID;
  name: string;
  color: string;
  order: number;
  /** won = ganho, lost = perdido, open = em andamento */
  kind: "open" | "won" | "lost";
}

export interface Tag {
  id: ID;
  name: string;
  color: string;
}

export type CustomFieldType = "text" | "number" | "date" | "select" | "checkbox" | "textarea";

export interface CustomField {
  id: ID;
  label: string;
  key: string;
  type: CustomFieldType;
  options: string[];
  required: boolean;
  showOnForm: boolean;
  entity: "contact";
  order: number;
}

export type ContactStatus = "lead" | "aluno" | "ex-aluno" | "inativo";

export interface Contact {
  id: ID;
  name: string;
  email: string;
  phone: string;
  document: string;
  birthDate: string;
  company: string;
  jobTitle: string;
  city: string;
  state: string;
  address: string;
  zip: string;
  source: string;
  status: ContactStatus;
  ownerId: ID | "";
  tagIds: ID[];
  custom: Record<string, string | number | boolean>;
  notes: string;
  optInEmail: boolean;
  optInWhatsapp: boolean;
  lgpdConsentAt: string;
  portalToken: string;
  createdAt: string;
  updatedAt: string;
  archived: boolean;
}

export interface Course {
  id: ID;
  name: string;
  code: string;
  description: string;
  category: string;
  price: number;
  hours: number;
  modality: "presencial" | "online" | "hibrido";
  active: boolean;
  createdAt: string;
}

export type ClassStatus = "planejada" | "aberta" | "em-andamento" | "concluida" | "cancelada";

export interface CourseClass {
  id: ID;
  courseId: ID;
  name: string;
  teacher: string;
  location: string;
  startDate: string;
  endDate: string;
  /** dias da semana 0-6 */
  weekDays: number[];
  startTime: string;
  endTime: string;
  capacity: number;
  price: number | null;
  status: ClassStatus;
  enrollToken: string;
  enrollOpen: boolean;
  minAttendancePct: number;
  createdAt: string;
}

export type EnrollmentStatus =
  | "pre-inscrito"
  | "matriculado"
  | "concluido"
  | "trancado"
  | "cancelado";

export interface Enrollment {
  id: ID;
  contactId: ID;
  classId: ID;
  status: EnrollmentStatus;
  price: number;
  discount: number;
  installments: number;
  paymentMethod: string;
  enrolledAt: string;
  source: string;
  certificateIssued: boolean;
  notes: string;
}

export type SessionStatus = "agendada" | "realizada" | "cancelada";

export interface ClassSession {
  id: ID;
  classId: ID;
  date: string;
  startTime: string;
  endTime: string;
  topic: string;
  teacher: string;
  status: SessionStatus;
  checkinToken: string;
  checkinOpen: boolean;
  createdAt: string;
}

export type AttendanceStatus = "presente" | "falta" | "atrasado" | "justificado";

export interface Attendance {
  id: ID;
  sessionId: ID;
  contactId: ID;
  status: AttendanceStatus;
  method: "manual" | "autocheckin" | "qrcode";
  note: string;
  at: string;
}

export type DealStatus = "aberto" | "ganho" | "perdido";

export interface Deal {
  id: ID;
  title: string;
  contactId: ID;
  courseId: ID | "";
  classId: ID | "";
  value: number;
  stageId: ID;
  status: DealStatus;
  probability: number;
  expectedCloseDate: string;
  lostReason: string;
  ownerId: ID | "";
  source: string;
  createdAt: string;
  updatedAt: string;
  closedAt: string;
}

export type ActivityType = "tarefa" | "ligacao" | "reuniao" | "email" | "whatsapp";

export interface Activity {
  id: ID;
  type: ActivityType;
  title: string;
  description: string;
  contactId: ID | "";
  dealId: ID | "";
  dueDate: string;
  done: boolean;
  doneAt: string;
  ownerId: ID | "";
  createdAt: string;
}

export interface Note {
  id: ID;
  contactId: ID;
  body: string;
  authorId: ID | "";
  createdAt: string;
}

export type PaymentStatus = "pendente" | "pago" | "atrasado" | "cancelado";

export interface Payment {
  id: ID;
  contactId: ID;
  enrollmentId: ID | "";
  description: string;
  amount: number;
  dueDate: string;
  paidAt: string;
  method: string;
  status: PaymentStatus;
  installment: number;
  installments: number;
  createdAt: string;
}

export interface Template {
  id: ID;
  name: string;
  channel: "email" | "whatsapp";
  subject: string;
  body: string;
}

export interface TimelineEvent {
  id: ID;
  type: string;
  contactId: ID | "";
  message: string;
  meta: Record<string, unknown>;
  actor: string;
  createdAt: string;
}

export interface FormSettings {
  headline: string;
  subheadline: string;
  successMessage: string;
  askDocument: boolean;
  askBirthDate: boolean;
  askAddress: boolean;
  askCompany: boolean;
  askHowFound: boolean;
  requirePhone: boolean;
  lgpdText: string;
  sourceOptions: string[];
}

export interface CrmData {
  org: Org;
  users: User[];
  stages: Stage[];
  tags: Tag[];
  customFields: CustomField[];
  contacts: Contact[];
  courses: Course[];
  classes: CourseClass[];
  enrollments: Enrollment[];
  sessions: ClassSession[];
  attendance: Attendance[];
  deals: Deal[];
  activities: Activity[];
  notes: Note[];
  payments: Payment[];
  templates: Template[];
  timeline: TimelineEvent[];
  form: FormSettings;
  lostReasons: string[];
  sources: string[];
}

export type Collection =
  | "users"
  | "stages"
  | "tags"
  | "customFields"
  | "contacts"
  | "courses"
  | "classes"
  | "enrollments"
  | "sessions"
  | "attendance"
  | "deals"
  | "activities"
  | "notes"
  | "payments"
  | "templates";
