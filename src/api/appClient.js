import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit as limitDocs,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  where,
} from "firebase/firestore";
import {
  createUserWithEmailAndPassword,
  deleteUser,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
} from "firebase/auth";
import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { auth, db, googleProvider, storage } from "@/api/firebaseClient";

const COLLECTIONS = {
  Client: "clients",
  Developer: "developers",
  Notification: "notifications",
  PriorityConfig: "priorityConfigs",
  Ticket: "tickets",
  User: "users",
};
const SIGNUP_PASSPHRASE = (import.meta.env.VITE_SIGNUP_PASSPHRASE || "").trim();

function toIsoString(value) {
  if (!value) return null;
  if (typeof value === "string") return value;
  if (typeof value?.toDate === "function") return value.toDate().toISOString();
  if (value instanceof Date) return value.toISOString();
  return null;
}

function normalizeValue(value) {
  if (Array.isArray(value)) {
    return value.map(normalizeValue);
  }

  if (value && typeof value === "object") {
    if (typeof value.toDate === "function") {
      return value.toDate().toISOString();
    }

    const normalized = {};
    for (const [key, nestedValue] of Object.entries(value)) {
      normalized[key] = normalizeValue(nestedValue);
    }
    return normalized;
  }

  return value;
}

function sanitizeForFirestore(value) {
  if (value === undefined) return undefined;

  if (Array.isArray(value)) {
    return value
      .map(sanitizeForFirestore)
      .filter((nested) => nested !== undefined);
  }

  if (value && typeof value === "object" && !(value instanceof Date)) {
    const sanitized = {};
    for (const [key, nestedValue] of Object.entries(value)) {
      const cleaned = sanitizeForFirestore(nestedValue);
      if (cleaned !== undefined) {
        sanitized[key] = cleaned;
      }
    }
    return sanitized;
  }

  return value;
}

function normalizeDoc(id, data) {
  const normalized = normalizeValue(data || {});

  if (!normalized.created_date && normalized.created_at) {
    normalized.created_date = toIsoString(normalized.created_at);
  }

  if (!normalized.updated_date && normalized.updated_at) {
    normalized.updated_date = toIsoString(normalized.updated_at);
  }

  return { id, ...normalized };
}

async function resolveDeveloperRoleByEmail(email) {
  const normalizedEmail = String(email || "").trim().toLowerCase();
  if (!normalizedEmail) return null;

  try {
    let snapshot = await getDocs(
      query(collection(db, "developers"), where("email", "==", normalizedEmail), limitDocs(1))
    );

    if (snapshot.empty) {
      const allDevelopers = await getDocs(collection(db, "developers"));
      const fallbackDoc = allDevelopers.docs.find((document) => {
        const data = document.data() || {};
        return String(data.email || "").trim().toLowerCase() === normalizedEmail;
      });
      if (!fallbackDoc) return null;
      snapshot = {
        empty: false,
        docs: [fallbackDoc],
      };
    }

    const developer = normalizeDoc(snapshot.docs[0].id, snapshot.docs[0].data());
    const role = developer?.app_role || developer?.role || "developer";
    return role === "tech_supervisor" ? "tech_supervisor" : "developer";
  } catch (error) {
    return null;
  }
}

function parseSort(sort) {
  if (!sort || typeof sort !== "string") {
    return { field: null, direction: "desc" };
  }

  if (sort.startsWith("-")) {
    return { field: sort.slice(1), direction: "desc" };
  }

  return { field: sort, direction: "asc" };
}

function sortInMemory(items, sort) {
  const { field, direction } = parseSort(sort);
  if (!field) return items;

  const sorted = [...items].sort((a, b) => {
    const aValue = a?.[field];
    const bValue = b?.[field];

    if (aValue === bValue) return 0;
    if (aValue === undefined || aValue === null) return 1;
    if (bValue === undefined || bValue === null) return -1;

    if (typeof aValue === "string" && typeof bValue === "string") {
      return aValue.localeCompare(bValue);
    }

    return aValue > bValue ? 1 : -1;
  });

  return direction === "desc" ? sorted.reverse() : sorted;
}

function limitInMemory(items, maxItems) {
  if (!Number.isFinite(maxItems) || maxItems <= 0) return items;
  return items.slice(0, maxItems);
}

function collectionRef(entityName) {
  const collectionName = COLLECTIONS[entityName];
  if (!collectionName) {
    throw new Error(`Entity non supportata: ${entityName}`);
  }
  return collection(db, collectionName);
}

async function ensureUserProfile(firebaseUser) {
  const userRef = doc(db, "users", firebaseUser.uid);
  const snapshot = await getDoc(userRef);
  const now = new Date().toISOString();

  if (!snapshot.exists()) {
    const initialUser = {
      email: firebaseUser.email || "",
      full_name: firebaseUser.displayName || firebaseUser.email || "User",
      role: "user",
      app_role: "user",
      created_date: now,
      updated_date: now,
      created_at: serverTimestamp(),
      updated_at: serverTimestamp(),
    };

    await setDoc(userRef, initialUser);
    return normalizeDoc(firebaseUser.uid, initialUser);
  }

  const current = snapshot.data() || {};
  const patch = {};

  if (firebaseUser.email && current.email !== firebaseUser.email) {
    patch.email = firebaseUser.email;
  }

  if (!current.full_name && (firebaseUser.displayName || firebaseUser.email)) {
    patch.full_name = firebaseUser.displayName || firebaseUser.email;
  }

  if (!current.role && !current.app_role) {
    patch.role = "user";
    patch.app_role = "user";
  }

  if (Object.keys(patch).length > 0) {
    patch.updated_date = now;
    patch.updated_at = serverTimestamp();
    await setDoc(userRef, patch, { merge: true });
  }

  const merged = { ...current, ...patch };
  let role = merged.app_role || merged.role || "user";

  if (role === "user" || role === "developer") {
    const linkedDeveloperRole = await resolveDeveloperRoleByEmail(merged.email || firebaseUser.email);
    if (linkedDeveloperRole && linkedDeveloperRole !== role) {
      role = linkedDeveloperRole;
      const rolePatch = {
        role,
        app_role: role,
        updated_date: now,
        updated_at: serverTimestamp(),
      };
      await setDoc(userRef, rolePatch, { merge: true });
      Object.assign(merged, rolePatch);
    }
  }

  return {
    ...normalizeDoc(firebaseUser.uid, merged),
    raw_role: merged.role || role,
    secondary_role: merged.role || role,
    role,
    app_role: merged.app_role || role,
  };
}

async function getCurrentUserOrThrow() {
  const firebaseUser = auth.currentUser;
  if (!firebaseUser) {
    const error = new Error("Authentication required");
    error.status = 401;
    throw error;
  }

  return ensureUserProfile(firebaseUser);
}

function createEntityApi(entityName) {
  const ref = collectionRef(entityName);
  const api = {
    async list(sort, maxItems) {
      const { field, direction } = parseSort(sort);

      try {
        const constraints = [];
        if (field) {
          constraints.push(orderBy(field, direction));
        }
        if (Number.isFinite(maxItems) && maxItems > 0) {
          constraints.push(limitDocs(maxItems));
        }

        const snapshot =
          constraints.length > 0
            ? await getDocs(query(ref, ...constraints))
            : await getDocs(ref);

        let items = snapshot.docs.map((document) =>
          normalizeDoc(document.id, document.data())
        );

        if (!field && sort) {
          items = sortInMemory(items, sort);
        }

        if (!(Number.isFinite(maxItems) && maxItems > 0 && constraints.length > 0)) {
          items = limitInMemory(items, maxItems);
        }

        return items;
      } catch (error) {
        const snapshot = await getDocs(ref);
        let items = snapshot.docs.map((document) =>
          normalizeDoc(document.id, document.data())
        );
        items = sortInMemory(items, sort);
        items = limitInMemory(items, maxItems);
        return items;
      }
    },

    async filter(filters = {}) {
      const filterEntries = Object.entries(filters).filter(
        ([, value]) => value !== undefined
      );

      if (filterEntries.length === 0) {
        return api.list();
      }

      try {
        const constraints = filterEntries.map(([key, value]) =>
          where(key, "==", value)
        );
        const snapshot = await getDocs(query(ref, ...constraints));
        return snapshot.docs.map((document) =>
          normalizeDoc(document.id, document.data())
        );
      } catch (error) {
        const all = await api.list();
        return all.filter((item) =>
          filterEntries.every(([key, value]) => item?.[key] === value)
        );
      }
    },

    async create(payload) {
      const now = new Date().toISOString();
      const currentUser = await getCurrentUserOrThrow();
      const sanitizedPayload = sanitizeForFirestore(payload || {});

      const data = {
        ...sanitizedPayload,
        created_date: sanitizedPayload.created_date || now,
        updated_date: now,
        created_at: serverTimestamp(),
        updated_at: serverTimestamp(),
      };

      if (entityName === "Ticket" && !data.created_by && currentUser?.email) {
        data.created_by = currentUser.email;
      }

      const documentRef = await addDoc(ref, data);
      return normalizeDoc(documentRef.id, data);
    },

    async update(id, payload) {
      if (!id) {
        throw new Error(`ID mancante per update su ${entityName}`);
      }

      const now = new Date().toISOString();
      const sanitizedPayload = sanitizeForFirestore(payload || {});
      const data = {
        ...sanitizedPayload,
        updated_date: now,
        updated_at: serverTimestamp(),
      };

      await setDoc(doc(db, COLLECTIONS[entityName], id), data, { merge: true });
      return normalizeDoc(id, data);
    },

    async delete(id) {
      if (!id) {
        throw new Error(`ID mancante per delete su ${entityName}`);
      }

      await deleteDoc(doc(db, COLLECTIONS[entityName], id));
      return { success: true, id };
    },
  };

  return api;
}

const authApi = {
  async me() {
    return getCurrentUserOrThrow();
  },

  async updateMe(payload = {}) {
    const user = await getCurrentUserOrThrow();
    const now = new Date().toISOString();
    const sanitizedPayload = sanitizeForFirestore(payload || {});

    if (sanitizedPayload.app_role && !sanitizedPayload.role) {
      sanitizedPayload.role = sanitizedPayload.app_role;
    }

    const data = {
      ...sanitizedPayload,
      updated_date: now,
      updated_at: serverTimestamp(),
    };

    await setDoc(doc(db, "users", user.id), data, { merge: true });
    return { ...user, ...normalizeValue(data) };
  },

  async signInWithEmail(email, password) {
    await signInWithEmailAndPassword(auth, email, password);
    return getCurrentUserOrThrow();
  },

  async signUpWithEmail(email, password, fullName = "", signupPassphrase = "") {
    if (!SIGNUP_PASSPHRASE) {
      throw new Error("Registrazione disabilitata: configura la parola chiave di accesso.");
    }

    if ((signupPassphrase || "").trim() !== SIGNUP_PASSPHRASE) {
      throw new Error("Parola chiave non valida.");
    }

    const credentials = await createUserWithEmailAndPassword(auth, email, password);
    const now = new Date().toISOString();

    await setDoc(
      doc(db, "users", credentials.user.uid),
      {
        email: credentials.user.email || email,
        full_name: fullName || credentials.user.displayName || email,
        role: "user",
        app_role: "user",
        created_date: now,
        updated_date: now,
        created_at: serverTimestamp(),
        updated_at: serverTimestamp(),
      },
      { merge: true }
    );

    return getCurrentUserOrThrow();
  },

  async signInWithGoogle() {
    const credentials = await signInWithPopup(auth, googleProvider);
    const email = credentials.user?.email || "";

    if (!email) {
      throw new Error("Account Google senza email associata.");
    }

    const existingUsers = await getDocs(
      query(collection(db, "users"), where("email", "==", email))
    );

    if (existingUsers.empty) {
      await deleteUser(credentials.user);
      await signOut(auth);
      throw new Error("Registrazione Google disabilitata: usa la parola chiave di accesso.");
    }

    return getCurrentUserOrThrow();
  },

  async logout() {
    await signOut(auth);
    return { success: true };
  },

  redirectToLogin() {
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("auth-required"));
    }
  },
};

const integrations = {
  Core: {
    async UploadFile({ file }) {
      if (!file) {
        throw new Error("Nessun file ricevuto per upload");
      }

      const ownerId = auth.currentUser?.uid || "anonymous";
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const fileRef = ref(storage, `uploads/${ownerId}/${Date.now()}-${safeName}`);

      await uploadBytes(fileRef, file);
      const fileUrl = await getDownloadURL(fileRef);

      return { file_url: fileUrl };
    },

    async SendEmail(payload) {
      const webhookUrl = import.meta.env.VITE_EMAIL_WEBHOOK_URL;

      if (!webhookUrl) {
        console.info(
          "SendEmail saltata: imposta VITE_EMAIL_WEBHOOK_URL per inviare email reali.",
          payload
        );
        return { status: "skipped" };
      }

      const response = await fetch(webhookUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const error = new Error(`Email webhook error (${response.status})`);
        error.status = response.status;
        throw error;
      }

      return { status: "queued" };
    },
  },
};

const appLogs = {
  async logUserInApp(pageName) {
    try {
      const user = auth.currentUser;
      if (!user) return { status: "skipped" };

      await addDoc(collection(db, "appLogs"), {
        user_id: user.uid,
        user_email: user.email || "",
        page_name: pageName,
        created_date: new Date().toISOString(),
        created_at: serverTimestamp(),
      });

      return { status: "ok" };
    } catch (error) {
      return { status: "error", message: error?.message || "log failed" };
    }
  },
};

export const appClient = {
  auth: authApi,
  entities: {
    Client: createEntityApi("Client"),
    Developer: createEntityApi("Developer"),
    Notification: createEntityApi("Notification"),
    PriorityConfig: createEntityApi("PriorityConfig"),
    Ticket: createEntityApi("Ticket"),
    User: createEntityApi("User"),
  },
  integrations,
  appLogs,
};

export default appClient;
