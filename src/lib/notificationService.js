import { appClient } from "@/api/appClient";
import { createPageUrl } from "@/utils";

function toIsoNow() {
  return new Date().toISOString();
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function isEmailLike(value) {
  const text = String(value || "").trim();
  if (!text) return false;
  return text.includes("@") && text.includes(".");
}

function extractEmailsFromComments(comments = []) {
  if (!Array.isArray(comments)) return [];

  return comments
    .map((comment) => comment?.email || comment?.user)
    .filter((value) => isEmailLike(value))
    .map(normalizeEmail)
    .filter(Boolean);
}

function normalizeName(value) {
  return String(value || "").trim().toLowerCase();
}

function ticketLink(ticketId) {
  return `${createPageUrl("TicketDetail")}?id=${ticketId}`;
}

async function listUsersByEmails(emails = []) {
  const normalized = Array.from(
    new Set((emails || []).map(normalizeEmail).filter(Boolean))
  );
  if (normalized.length === 0) return [];

  const allUsers = await appClient.entities.User.list();
  return allUsers.filter((user) => normalized.includes(normalizeEmail(user.email)));
}

async function listUsersByIds(ids = []) {
  const normalized = Array.from(new Set((ids || []).filter(Boolean)));
  if (normalized.length === 0) return [];

  const allUsers = await appClient.entities.User.list();
  return allUsers.filter((user) => normalized.includes(user.id));
}

async function resolveActor(actor) {
  if (actor?.id) {
    return {
      id: actor.id,
      email: actor?.email || "",
      name: actor?.full_name || actor?.email || "User",
    };
  }

  try {
    const me = await appClient.auth.me();
    return {
      id: me?.id || null,
      email: me?.email || "",
      name: me?.full_name || me?.email || "User",
    };
  } catch (error) {
    return {
      id: null,
      email: "",
      name: "User",
    };
  }
}

async function resolveClientTechSupervisorUsers(client) {
  if (!client) return [];

  const developers = await appClient.entities.Developer.list();
  const supervisorId = String(client.tech_supervisor_id || "").trim();
  const supervisorName = normalizeName(client.tech_supervisor_name);

  const supervisor =
    developers.find((developer) => developer.id === supervisorId) ||
    developers.find((developer) => {
      const developerName = normalizeName(developer?.name);
      const developerEmail = normalizeEmail(developer?.email);
      return Boolean(supervisorName && (developerName === supervisorName || developerEmail === supervisorName));
    });

  if (!supervisor?.email) return [];
  return listUsersByEmails([supervisor.email]);
}

async function resolveClientAnalystUsers(client) {
  if (!client) return [];

  const users = await appClient.entities.User.list();
  const analystIds = new Set(
    Array.isArray(client.analyst_team_ids)
      ? client.analyst_team_ids.map((value) => String(value || "").trim()).filter(Boolean)
      : []
  );
  const analystNames = new Set(
    Array.isArray(client.analyst_team_names)
      ? client.analyst_team_names.map((value) => normalizeName(value)).filter(Boolean)
      : []
  );
  const analystEmails = new Set(
    Array.isArray(client.analyst_team_emails)
      ? client.analyst_team_emails.map(normalizeEmail).filter(Boolean)
      : []
  );

  return users.filter((user) => {
    const normalizedUserEmail = normalizeEmail(user?.email);
    const normalizedUserName = normalizeName(user?.full_name || user?.email);
    return Boolean(
      (user?.id && analystIds.has(String(user.id))) ||
        (normalizedUserEmail && analystEmails.has(normalizedUserEmail)) ||
        (normalizedUserName && analystNames.has(normalizedUserName))
    );
  });
}

async function resolveAdminUsers() {
  const users = await appClient.entities.User.list();
  return users.filter((user) => {
    const role = String(user?.app_role || user?.role || "").trim().toLowerCase();
    return role === "admin";
  });
}

function dedupeRecipients(users = []) {
  const recipients = new Map();
  users.forEach((user) => {
    if (!user?.id) return;
    recipients.set(user.id, user);
  });
  return [...recipients.values()];
}

export async function createNotification({
  recipientId,
  recipientEmail = "",
  actor = null,
  type = "generic",
  title,
  body = "",
  ticket = null,
  metadata = {},
}) {
  if (!recipientId || !title) return null;

  const actorInfo = await resolveActor(actor);
  if (!actorInfo.id) return null;
  if (actorInfo.id && recipientId === actorInfo.id) return null;

  return appClient.entities.Notification.create({
    recipient_id: recipientId,
    recipient_email: recipientEmail || "",
    actor_id: actorInfo.id,
    actor_email: actorInfo.email || "",
    actor_name: actorInfo.name,
    type,
    title,
    body,
    read: false,
    read_at: null,
    ticket_id: ticket?.id || null,
    ticket_title: ticket?.title || "",
    link: ticket?.id ? ticketLink(ticket.id) : "",
    metadata,
    event_at: toIsoNow(),
  });
}

export async function notifyTicketAssigned({ ticket, actor }) {
  if (!ticket?.id || !ticket?.assignee_email) return;

  const users = await listUsersByEmails([ticket.assignee_email]);
  if (users.length === 0) return;

  await Promise.all(
    users.map((recipient) =>
      createNotification({
        recipientId: recipient.id,
        recipientEmail: recipient.email,
        actor,
        type: "ticket_assigned",
        title: "Nuovo ticket assegnato",
        body: `${ticket.title}`,
        ticket,
      })
    )
  );
}

export async function notifyTicketComment({
  ticket,
  actor,
  commentText = "",
  extraRecipientEmails = [],
  extraRecipientIds = [],
  client = null,
}) {
  if (!ticket?.id) return;

  const clientSupervisorUsers = await resolveClientTechSupervisorUsers(client);
  const recipientEmails = [
    ticket.assignee_email,
    ticket.created_by,
    ...extractEmailsFromComments(ticket?.comments || []),
    ...(extraRecipientEmails || []),
    ...clientSupervisorUsers.map((user) => user.email),
  ]
    .map(normalizeEmail)
    .filter(Boolean);
  const recipientIds = Array.from(new Set((extraRecipientIds || []).filter(Boolean)));
  if (recipientEmails.length === 0 && recipientIds.length === 0) return;

  const usersByEmail = await listUsersByEmails(Array.from(new Set(recipientEmails)));
  const usersById = await listUsersByIds(recipientIds);
  const recipients = new Map();

  [...usersByEmail, ...usersById].forEach((user) => {
    if (!user?.id) return;
    recipients.set(user.id, user);
  });

  const users = [...recipients.values()];
  if (users.length === 0) return;

  const preview = String(commentText || "").trim();
  const body = preview.length > 140 ? `${preview.slice(0, 137)}...` : preview;
  const actorName = actor?.full_name || actor?.email || "Un utente";

  await Promise.all(
    users.map((recipient) =>
      createNotification({
        recipientId: recipient.id,
        recipientEmail: recipient.email,
        actor,
        type: "ticket_comment",
        title: `Commento di ${actorName} su "${ticket.title}"`,
        body,
        ticket,
      })
    )
  );
}

export async function notifyClientTicketUpdate({
  ticket,
  actor,
  client,
  title,
  body = "",
  metadata = {},
  type = "ticket_client_update",
}) {
  if (!ticket?.id || !client || !title) return;

  const recipients = await resolveClientTechSupervisorUsers(client);
  if (recipients.length === 0) return;

  await Promise.all(
    recipients.map((recipient) =>
      createNotification({
        recipientId: recipient.id,
        recipientEmail: recipient.email,
        actor,
        type,
        title,
        body,
        ticket,
        metadata: {
          client_id: client.id || null,
          ...metadata,
        },
      })
    )
  );
}

export async function notifyTicketDone({ ticket, actor }) {
  if (!ticket?.id || !ticket?.created_by) return;

  const users = await listUsersByEmails([ticket.created_by]);
  if (users.length === 0) return;

  await Promise.all(
    users.map((recipient) =>
      createNotification({
        recipientId: recipient.id,
        recipientEmail: recipient.email,
        actor,
        type: "ticket_done",
        title: "Ticket completato",
        body: `${ticket.title}`,
        ticket,
      })
    )
  );
}

export async function notifyTicketMissingData({ ticket, actor, client }) {
  if (!ticket?.id || !client) return;

  const developers = await appClient.entities.Developer.list();
  const recipientEmails = new Set();
  const recipientIds = new Set();

  const supervisor = developers.find((dev) => dev.id === client.tech_supervisor_id);
  if (supervisor?.email) recipientEmails.add(supervisor.email);

  developers
    .filter((dev) => (client.operations_ids || []).includes(dev.id))
    .forEach((dev) => {
      if (dev?.email) recipientEmails.add(dev.email);
    });

  (client.analyst_team_ids || []).forEach((id) => {
    if (id) recipientIds.add(id);
  });

  const usersByEmail = await listUsersByEmails([...recipientEmails]);
  const usersById = await listUsersByIds([...recipientIds]);
  const recipients = new Map();

  [...usersByEmail, ...usersById].forEach((recipient) => {
    if (!recipient?.id) return;
    recipients.set(recipient.id, recipient);
  });

  if (recipients.size === 0) return;

  await Promise.all(
    [...recipients.values()].map((recipient) =>
      createNotification({
        recipientId: recipient.id,
        recipientEmail: recipient.email,
        actor,
        type: "ticket_missing_data",
        title: "Ticket fermo: mancano dati",
        body: `${ticket.title} · ${client.name || ticket.client_name || "Cliente"}`,
        ticket,
        metadata: {
          client_id: client.id || null,
          reason: "missing_required_data",
        },
      })
    )
  );
}

export async function notifyQaReviewApproved({ ticket, actor, client }) {
  if (!ticket?.id || !client) return;

  const recipients = dedupeRecipients([
    ...(await resolveClientAnalystUsers(client)),
    ...(await resolveAdminUsers()),
  ]);
  if (recipients.length === 0) return;

  await Promise.all(
    recipients.map((recipient) =>
      createNotification({
        recipientId: recipient.id,
        recipientEmail: recipient.email,
        actor,
        type: "qa_review_approved",
        title: "Preview approvata",
        body: `${ticket.title} · review completata`,
        ticket,
        metadata: {
          client_id: client.id || null,
          reason: "qa_review_approved",
        },
      })
    )
  );
}

export async function notifyQaReviewRejected({
  ticket,
  actor,
  client,
  developerEmail = "",
}) {
  if (!ticket?.id || !client) return;

  const devUsers = developerEmail ? await listUsersByEmails([developerEmail]) : [];
  const recipients = dedupeRecipients([
    ...devUsers,
    ...(await resolveClientAnalystUsers(client)),
  ]);
  if (recipients.length === 0) return;

  await Promise.all(
    recipients.map((recipient) =>
      createNotification({
        recipientId: recipient.id,
        recipientEmail: recipient.email,
        actor,
        type: "qa_review_rejected",
        title: "Preview rifiutata",
        body: `${ticket.title} · creato ticket di fix`,
        ticket,
        metadata: {
          client_id: client.id || null,
          reason: "qa_review_rejected",
        },
      })
    )
  );
}

export async function notifyLiveOpsCompleted({
  ticket,
  actor,
  client,
  operationType = "change",
}) {
  if (!ticket?.id || !client) return;

  const normalizedType = String(operationType || "").trim().toLowerCase();
  const labels = {
    launch: "Messa live",
    stop: "Spegnimento",
    change: "Modifica live",
  };
  const operationLabel = labels[normalizedType] || labels.change;

  const recipients = dedupeRecipients([
    ...(await resolveClientAnalystUsers(client)),
    ...(await resolveAdminUsers()),
  ]);
  if (recipients.length === 0) return;

  await Promise.all(
    recipients.map((recipient) =>
      createNotification({
        recipientId: recipient.id,
        recipientEmail: recipient.email,
        actor,
        type: "live_ops_completed",
        title: `${operationLabel} completata`,
        body: `${ticket.title}`,
        ticket,
        metadata: {
          client_id: client.id || null,
          reason: "live_ops_completed",
          live_operation_type: normalizedType,
        },
      })
    )
  );
}
