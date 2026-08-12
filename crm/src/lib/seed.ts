import type { CrmData } from "./types";
import { hashPassword, token, uid } from "./utils";

function iso(daysFromToday: number): string {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() + daysFromToday);
  return d.toISOString().slice(0, 10);
}

function ts(daysFromToday: number): string {
  const d = new Date();
  d.setDate(d.getDate() + daysFromToday);
  return d.toISOString();
}

export const DEFAULT_STAGES = [
  { name: "Novo lead", color: "#64748b", kind: "open" as const },
  { name: "Contato feito", color: "#0ea5e9", kind: "open" as const },
  { name: "Interessado", color: "#8b5cf6", kind: "open" as const },
  { name: "Proposta enviada", color: "#f59e0b", kind: "open" as const },
  { name: "Negociacao", color: "#f97316", kind: "open" as const },
  { name: "Matriculado", color: "#16a34a", kind: "won" as const },
  { name: "Perdido", color: "#dc2626", kind: "lost" as const },
];

export function buildSeed(adminPassword: string): CrmData {
  const stages = DEFAULT_STAGES.map((s, i) => ({
    id: `stage_${i + 1}`,
    name: s.name,
    color: s.color,
    order: i,
    kind: s.kind,
  }));

  const admin = {
    id: "user_admin",
    name: "Administrador",
    email: "admin@crm.local",
    role: "admin" as const,
    passwordHash: hashPassword(adminPassword),
    active: true,
    createdAt: ts(-90),
  };

  const tags = [
    { id: "tag_1", name: "Quente", color: "#dc2626" },
    { id: "tag_2", name: "Morno", color: "#f59e0b" },
    { id: "tag_3", name: "Frio", color: "#0ea5e9" },
    { id: "tag_4", name: "Indicacao", color: "#8b5cf6" },
    { id: "tag_5", name: "Empresa", color: "#0f766e" },
    { id: "tag_6", name: "Bolsista", color: "#16a34a" },
  ];

  const courses = [
    {
      id: "course_1",
      name: "Excel Avancado para Negocios",
      code: "EXC-AV",
      description: "Formulas, tabelas dinamicas, dashboards e automacao com macros.",
      category: "Tecnologia",
      price: 1290,
      hours: 40,
      modality: "hibrido" as const,
      active: true,
      createdAt: ts(-120),
    },
    {
      id: "course_2",
      name: "Marketing Digital do Zero",
      code: "MKT-01",
      description: "Trafego pago, conteudo, funil de vendas e metricas.",
      category: "Marketing",
      price: 1890,
      hours: 60,
      modality: "online" as const,
      active: true,
      createdAt: ts(-100),
    },
    {
      id: "course_3",
      name: "Gestao Financeira para PMEs",
      code: "FIN-PME",
      description: "Fluxo de caixa, precificacao, DRE e planejamento.",
      category: "Financas",
      price: 2400,
      hours: 32,
      modality: "presencial" as const,
      active: true,
      createdAt: ts(-60),
    },
  ];

  const classes = [
    {
      id: "class_1",
      courseId: "course_1",
      name: "Excel Avancado - Turma Noite 2026.1",
      teacher: "Prof. Marina Alves",
      location: "Sala 3 - Unidade Centro",
      startDate: iso(-28),
      endDate: iso(21),
      weekDays: [2, 4],
      startTime: "19:00",
      endTime: "22:00",
      capacity: 25,
      price: null,
      status: "em-andamento" as const,
      enrollToken: token(10),
      enrollOpen: true,
      minAttendancePct: 75,
      createdAt: ts(-60),
    },
    {
      id: "class_2",
      courseId: "course_2",
      name: "Marketing Digital - Turma Online Manha",
      teacher: "Prof. Rafael Souza",
      location: "Google Meet",
      startDate: iso(10),
      endDate: iso(70),
      weekDays: [1, 3],
      startTime: "09:00",
      endTime: "11:00",
      capacity: 60,
      price: 1690,
      status: "aberta" as const,
      enrollToken: token(10),
      enrollOpen: true,
      minAttendancePct: 70,
      createdAt: ts(-30),
    },
    {
      id: "class_3",
      courseId: "course_3",
      name: "Gestao Financeira - Turma Sabado",
      teacher: "Prof. Carla Menezes",
      location: "Auditorio - Unidade Sul",
      startDate: iso(24),
      endDate: iso(80),
      weekDays: [6],
      startTime: "08:30",
      endTime: "12:30",
      capacity: 30,
      price: null,
      status: "aberta" as const,
      enrollToken: token(10),
      enrollOpen: true,
      minAttendancePct: 75,
      createdAt: ts(-20),
    },
  ];

  const people: Array<[string, string, string, string, string, string]> = [
    ["Ana Beatriz Lima", "ana.lima@email.com", "11987650001", "Instagram", "Sao Paulo", "SP"],
    ["Bruno Carvalho", "bruno.carvalho@email.com", "11987650002", "Indicacao", "Sao Paulo", "SP"],
    ["Carla Fernandes", "carla.f@email.com", "11987650003", "Google", "Campinas", "SP"],
    ["Diego Martins", "diego.martins@email.com", "11987650004", "Site", "Santos", "SP"],
    ["Eduarda Ramos", "duda.ramos@email.com", "11987650005", "Instagram", "Sao Paulo", "SP"],
    ["Felipe Nogueira", "felipe.n@email.com", "11987650006", "Facebook", "Guarulhos", "SP"],
    ["Gabriela Souza", "gabi.souza@email.com", "11987650007", "Indicacao", "Sao Paulo", "SP"],
    ["Henrique Dias", "henrique.dias@email.com", "11987650008", "Google", "Osasco", "SP"],
    ["Isabela Rocha", "isabela.rocha@email.com", "11987650009", "Evento", "Sao Paulo", "SP"],
    ["Joao Pedro Alves", "joao.alves@email.com", "11987650010", "Site", "Sao Bernardo", "SP"],
    ["Karina Melo", "karina.melo@email.com", "11987650011", "Instagram", "Sao Paulo", "SP"],
    ["Lucas Barbosa", "lucas.barbosa@email.com", "11987650012", "LinkedIn", "Sao Paulo", "SP"],
    ["Mariana Costa", "mariana.costa@email.com", "11987650013", "Indicacao", "Diadema", "SP"],
    ["Nicolas Prado", "nicolas.prado@email.com", "11987650014", "Google", "Sao Paulo", "SP"],
    ["Olivia Tavares", "olivia.t@email.com", "11987650015", "Site", "Jundiai", "SP"],
    ["Paulo Ricardo Nunes", "paulo.nunes@email.com", "11987650016", "Evento", "Sao Paulo", "SP"],
    ["Renata Bianchi", "renata.b@email.com", "11987650017", "Instagram", "Sao Paulo", "SP"],
    ["Sergio Antunes", "sergio.antunes@email.com", "11987650018", "LinkedIn", "Barueri", "SP"],
  ];

  const contacts = people.map(([name, email, phone, source, city, state], i) => {
    const isStudent = i < 11;
    return {
      id: `contact_${i + 1}`,
      name,
      email,
      phone,
      document: "",
      birthDate: "",
      company: i % 4 === 0 ? "Empresa Exemplo LTDA" : "",
      jobTitle: i % 4 === 0 ? "Analista" : "",
      city,
      state,
      address: "",
      zip: "",
      source,
      status: (isStudent ? "aluno" : "lead") as "aluno" | "lead",
      ownerId: "user_admin",
      tagIds: [tags[i % 4].id],
      custom: {},
      notes: "",
      optInEmail: true,
      optInWhatsapp: true,
      lgpdConsentAt: ts(-40 + i),
      portalToken: token(12),
      createdAt: ts(-45 + i),
      updatedAt: ts(-10 + (i % 9)),
      archived: false,
    };
  });

  // Matriculas: 8 na turma 1 (em andamento), 3 na turma 2.
  const enrollments = [
    ...contacts.slice(0, 8).map((c, i) => ({
      id: `enr_${i + 1}`,
      contactId: c.id,
      classId: "class_1",
      status: "matriculado" as const,
      price: 1290,
      discount: i === 2 ? 190 : 0,
      installments: 3,
      paymentMethod: "Cartao de credito",
      enrolledAt: ts(-35 + i),
      source: c.source,
      certificateIssued: false,
      notes: "",
    })),
    ...contacts.slice(8, 11).map((c, i) => ({
      id: `enr_${9 + i}`,
      contactId: c.id,
      classId: "class_2",
      status: "pre-inscrito" as const,
      price: 1690,
      discount: 0,
      installments: 6,
      paymentMethod: "Pix",
      enrolledAt: ts(-6 + i),
      source: c.source,
      certificateIssued: false,
      notes: "",
    })),
  ];

  // Aulas da turma 1: terças e quintas dentro do periodo
  const sessions: CrmData["sessions"] = [];
  const topics = [
    "Introducao e ambiente do Excel",
    "Formulas essenciais e referencias",
    "Funcoes de busca (PROCX/PROCV)",
    "Tabelas dinamicas na pratica",
    "Graficos e dashboards",
    "Formatacao condicional avancada",
    "Power Query - importacao de dados",
    "Macros e automacao",
    "Projeto final - parte 1",
    "Projeto final - parte 2",
  ];
  let count = 0;
  for (let d = -28; d <= 21 && count < 10; d++) {
    const day = new Date();
    day.setHours(12, 0, 0, 0);
    day.setDate(day.getDate() + d);
    if (![2, 4].includes(day.getDay())) continue;
    const dateStr = day.toISOString().slice(0, 10);
    sessions.push({
      id: `sess_${count + 1}`,
      classId: "class_1",
      date: dateStr,
      startTime: "19:00",
      endTime: "22:00",
      topic: topics[count] || `Aula ${count + 1}`,
      teacher: "Prof. Marina Alves",
      status: d <= 0 ? "realizada" : "agendada",
      checkinToken: token(10),
      checkinOpen: d === 0,
      createdAt: ts(-40),
    });
    count++;
  }

  // Presencas para aulas realizadas
  const attendance: CrmData["attendance"] = [];
  sessions
    .filter((s) => s.status === "realizada")
    .forEach((s, si) => {
      contacts.slice(0, 8).forEach((c, ci) => {
        const roll = (si * 7 + ci * 3) % 10;
        const status =
          roll === 0 ? "falta" : roll === 1 ? "atrasado" : roll === 2 ? "justificado" : "presente";
        attendance.push({
          id: `att_${si}_${ci}`,
          sessionId: s.id,
          contactId: c.id,
          status: status as CrmData["attendance"][number]["status"],
          method: "manual",
          note: "",
          at: `${s.date}T19:10:00.000Z`,
        });
      });
    });

  // Oportunidades para os leads
  const deals: CrmData["deals"] = contacts.slice(11).map((c, i) => {
    const stageIdx = i % 5;
    return {
      id: `deal_${i + 1}`,
      title: `${courses[i % 3].name} - ${c.name.split(" ")[0]}`,
      contactId: c.id,
      courseId: courses[i % 3].id,
      classId: (i % 2 === 0 ? "class_2" : "class_3") as string,
      value: courses[i % 3].price,
      stageId: stages[stageIdx].id,
      status: "aberto" as const,
      probability: [10, 25, 45, 65, 80][stageIdx],
      expectedCloseDate: iso(5 + i * 3),
      lostReason: "",
      ownerId: "user_admin",
      source: c.source,
      createdAt: ts(-20 + i),
      updatedAt: ts(-2),
      closedAt: "",
    };
  });
  // Alguns negocios ja ganhos, para o funil ter historico
  contacts.slice(0, 4).forEach((c, i) => {
    deals.push({
      id: `deal_w${i + 1}`,
      title: `${courses[0].name} - ${c.name.split(" ")[0]}`,
      contactId: c.id,
      courseId: "course_1",
      classId: "class_1",
      value: 1290,
      stageId: stages[5].id,
      status: "ganho",
      probability: 100,
      expectedCloseDate: iso(-30 + i),
      lostReason: "",
      ownerId: "user_admin",
      source: c.source,
      createdAt: ts(-50 + i),
      updatedAt: ts(-30),
      closedAt: ts(-30 + i),
    });
  });

  const activities = [
    {
      id: uid("act"),
      type: "ligacao" as const,
      title: "Ligar para confirmar interesse na turma de Marketing",
      description: "",
      contactId: "contact_12",
      dealId: "deal_1",
      dueDate: iso(0),
      done: false,
      doneAt: "",
      ownerId: "user_admin",
      createdAt: ts(-2),
    },
    {
      id: uid("act"),
      type: "whatsapp" as const,
      title: "Enviar proposta com desconto de lancamento",
      description: "",
      contactId: "contact_13",
      dealId: "deal_2",
      dueDate: iso(1),
      done: false,
      doneAt: "",
      ownerId: "user_admin",
      createdAt: ts(-1),
    },
    {
      id: uid("act"),
      type: "tarefa" as const,
      title: "Cobrar mensalidade em atraso",
      description: "",
      contactId: "contact_3",
      dealId: "",
      dueDate: iso(-1),
      done: false,
      doneAt: "",
      ownerId: "user_admin",
      createdAt: ts(-5),
    },
    {
      id: uid("act"),
      type: "reuniao" as const,
      title: "Reuniao com RH da Empresa Exemplo (turma fechada)",
      description: "Proposta para 12 colaboradores.",
      contactId: "contact_16",
      dealId: "",
      dueDate: iso(3),
      done: false,
      doneAt: "",
      ownerId: "user_admin",
      createdAt: ts(-3),
    },
  ];

  // Financeiro: parcelas das matriculas da turma 1
  const payments: CrmData["payments"] = [];
  enrollments.forEach((e, ei) => {
    const total = e.price - e.discount;
    const per = Math.round((total / e.installments) * 100) / 100;
    for (let i = 0; i < e.installments; i++) {
      const due = iso(-30 + i * 30 + (ei % 3));
      const isPast = new Date(due) < new Date();
      payments.push({
        id: `pay_${ei}_${i}`,
        contactId: e.contactId,
        enrollmentId: e.id,
        description: `Parcela ${i + 1}/${e.installments}`,
        amount: per,
        dueDate: due,
        paidAt: isPast && (ei + i) % 5 !== 0 ? due : "",
        method: e.paymentMethod,
        status: isPast ? ((ei + i) % 5 !== 0 ? "pago" : "atrasado") : "pendente",
        installment: i + 1,
        installments: e.installments,
        createdAt: e.enrolledAt,
      });
    }
  });

  const templates = [
    {
      id: "tpl_1",
      name: "Boas-vindas (novo lead)",
      channel: "whatsapp" as const,
      subject: "",
      body:
        "Ola {{nome}}! Aqui e da {{escola}}. Vi seu interesse no curso {{curso}}. Posso te enviar os detalhes de turmas e valores?",
    },
    {
      id: "tpl_2",
      name: "Link de inscricao",
      channel: "whatsapp" as const,
      subject: "",
      body:
        "Oi {{nome}}! Segue o link para voce finalizar sua inscricao no curso {{curso}}: {{link}} . Qualquer duvida e so chamar!",
    },
    {
      id: "tpl_3",
      name: "Confirmacao de matricula",
      channel: "email" as const,
      subject: "Matricula confirmada - {{curso}}",
      body:
        "Ola {{nome}},\n\nSua matricula no curso {{curso}} (turma {{turma}}) foi confirmada.\nInicio: {{inicio}}\nLocal: {{local}}\n\nQualquer duvida, responda este e-mail.\n\nEquipe {{escola}}",
    },
    {
      id: "tpl_4",
      name: "Cobranca amigavel",
      channel: "whatsapp" as const,
      subject: "",
      body:
        "Ola {{nome}}, tudo bem? Identificamos uma parcela em aberto do curso {{curso}}. Posso te ajudar a regularizar?",
    },
    {
      id: "tpl_5",
      name: "Alerta de faltas",
      channel: "whatsapp" as const,
      subject: "",
      body:
        "Oi {{nome}}! Sentimos sua falta nas ultimas aulas de {{curso}}. Sua frequencia esta em {{frequencia}}. Podemos ajudar em algo?",
    },
  ];

  return {
    org: {
      name: "Escola Exemplo",
      tagline: "Cursos que transformam carreiras",
      email: "contato@escolaexemplo.com.br",
      phone: "11999990000",
      website: "https://escolaexemplo.com.br",
      primaryColor: "#4f46e5",
      currency: "BRL",
      logoText: "EE",
    },
    users: [admin],
    stages,
    tags,
    customFields: [
      {
        id: "cf_1",
        label: "Como pretende pagar?",
        key: "forma_pagamento",
        type: "select",
        options: ["Pix", "Cartao de credito", "Boleto", "Empresa paga"],
        required: false,
        showOnForm: true,
        entity: "contact",
        order: 0,
      },
      {
        id: "cf_2",
        label: "Objetivo com o curso",
        key: "objetivo",
        type: "textarea",
        options: [],
        required: false,
        showOnForm: true,
        entity: "contact",
        order: 1,
      },
    ],
    contacts,
    courses,
    classes,
    enrollments,
    sessions,
    attendance,
    deals,
    activities,
    notes: [
      {
        id: uid("note"),
        contactId: "contact_12",
        body: "Cliente pediu para retomar contato depois do dia 20. Interesse alto em marketing.",
        authorId: "user_admin",
        createdAt: ts(-4),
      },
    ],
    payments,
    templates,
    timeline: [
      {
        id: uid("ev"),
        type: "sistema",
        contactId: "",
        message: "CRM inicializado com dados de demonstracao.",
        meta: {},
        actor: "sistema",
        createdAt: ts(0),
      },
    ],
    form: {
      headline: "Faca sua inscricao",
      subheadline: "Preencha os dados abaixo e garanta sua vaga. E rapido!",
      successMessage:
        "Inscricao recebida! Nossa equipe entrara em contato em breve com os proximos passos.",
      askDocument: true,
      askBirthDate: true,
      askAddress: false,
      askCompany: false,
      askHowFound: true,
      requirePhone: true,
      lgpdText:
        "Autorizo o contato por e-mail e WhatsApp sobre este curso e concordo com o tratamento dos meus dados conforme a LGPD.",
      sourceOptions: [
        "Instagram",
        "Facebook",
        "Google",
        "Indicacao de amigo",
        "LinkedIn",
        "Evento",
        "Site",
        "Outro",
      ],
    },
    lostReasons: [
      "Preco acima do orcamento",
      "Escolheu concorrente",
      "Sem tempo / horario incompativel",
      "Nao respondeu",
      "Fora do perfil",
    ],
    sources: [
      "Instagram",
      "Facebook",
      "Google",
      "Indicacao",
      "LinkedIn",
      "Evento",
      "Site",
      "Formulario de inscricao",
      "Outro",
    ],
  };
}
