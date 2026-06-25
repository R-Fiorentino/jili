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
const ENTITY_CACHE_TTL_MS = {
  Client: 5 * 60 * 1000,
  Developer: 2 * 60 * 1000,
  Notification: 15 * 1000,
  PriorityConfig: 5 * 60 * 1000,
  Ticket: 30 * 1000,
  User: 2 * 60 * 1000,
};
const entityRequestCache = new Map();
const entityRequestsInFlight = new Map();
const entityCacheVersions = new Map();
let cachedUserProfile = null;
let userProfileRequestInFlight = null;

function getEntityCacheKey(entityName, operation, params = "") {
  return `${entityName}:${operation}:${params}`;
}

function getFullListCacheKey(entityName) {
  return getEntityCacheKey(entityName, "list", "all");
}

function readEntityCache(cacheKey) {
  const cached = entityRequestCache.get(cacheKey);
  if (!cached) return null;
  if (cached.expiresAt <= Date.now()) {
    entityRequestCache.delete(cacheKey);
    return null;
  }
  return cached.data;
}

function writeEntityCache(entityName, cacheKey, data) {
  entityRequestCache.set(cacheKey, {
    data,
    expiresAt: Date.now() + (ENTITY_CACHE_TTL_MS[entityName] || 30 * 1000),
  });
  return data;
}

function clearEntityRequestCache(entityName, { preserveFullList = false } = {}) {
  entityCacheVersions.set(
    entityName,
    (entityCacheVersions.get(entityName) || 0) + 1
  );
  const fullListKey = getFullListCacheKey(entityName);
  for (const key of entityRequestCache.keys()) {
    if (!key.startsWith(`${entityName}:`)) continue;
    if (preserveFullList && key === fullListKey) continue;
    entityRequestCache.delete(key);
  }
  for (const key of entityRequestsInFlight.keys()) {
    if (key.startsWith(`${entityName}:`)) entityRequestsInFlight.delete(key);
  }
}

function updateCachedFullList(entityName, updater) {
  const fullListKey = getFullListCacheKey(entityName);
  const cachedItems = readEntityCache(fullListKey);
  clearEntityRequestCache(entityName);
  if (!Array.isArray(cachedItems)) return;
  writeEntityCache(entityName, fullListKey, updater(cachedItems));
}

async function runCachedEntityRequest(entityName, cacheKey, request) {
  const cached = readEntityCache(cacheKey);
  if (cached) return cached;

  const inFlight = entityRequestsInFlight.get(cacheKey);
  if (inFlight) return inFlight;

  const requestVersion = entityCacheVersions.get(entityName) || 0;
  let pending;
  pending = Promise.resolve()
    .then(request)
    .then((data) => {
      if ((entityCacheVersions.get(entityName) || 0) !== requestVersion) {
        return data;
      }
      return writeEntityCache(entityName, cacheKey, data);
    })
    .finally(() => {
      if (entityRequestsInFlight.get(cacheKey) === pending) {
        entityRequestsInFlight.delete(cacheKey);
      }
    });

  entityRequestsInFlight.set(cacheKey, pending);
  return pending;
}

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
  if (
    cachedUserProfile?.uid === firebaseUser.uid &&
    cachedUserProfile.expiresAt > Date.now()
  ) {
    return cachedUserProfile.data;
  }
  if (userProfileRequestInFlight?.uid === firebaseUser.uid) {
    return userProfileRequestInFlight.promise;
  }

  const profilePromise = loadAndEnsureUserProfile(firebaseUser).finally(() => {
    if (userProfileRequestInFlight?.uid === firebaseUser.uid) {
      userProfileRequestInFlight = null;
    }
  });
  userProfileRequestInFlight = {
    uid: firebaseUser.uid,
    promise: profilePromise,
  };
  return profilePromise;
}

async function loadAndEnsureUserProfile(firebaseUser) {
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
    const normalizedInitialUser = normalizeDoc(firebaseUser.uid, initialUser);
    cachedUserProfile = {
      uid: firebaseUser.uid,
      data: normalizedInitialUser,
      expiresAt: Date.now() + ENTITY_CACHE_TTL_MS.User,
    };
    return normalizedInitialUser;
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

  const normalizedUser = {
    ...normalizeDoc(firebaseUser.uid, merged),
    raw_role: merged.role || role,
    secondary_role: merged.role || role,
    role,
    app_role: merged.app_role || role,
  };
  cachedUserProfile = {
    uid: firebaseUser.uid,
    data: normalizedUser,
    expiresAt: Date.now() + ENTITY_CACHE_TTL_MS.User,
  };
  return normalizedUser;
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
      const fullListKey = getFullListCacheKey(entityName);
      const cachedFullList = readEntityCache(fullListKey);
      if (cachedFullList) {
        return limitInMemory(sortInMemory(cachedFullList, sort), maxItems);
      }

      const { field, direction } = parseSort(sort);
      const cacheKey =
        !field && !Number.isFinite(maxItems)
          ? fullListKey
          : getEntityCacheKey(
              entityName,
              "list",
              JSON.stringify({ sort: sort || "", maxItems: maxItems || null })
            );

      return runCachedEntityRequest(entityName, cacheKey, async () => {
        const constraints = [];
        if (field) constraints.push(orderBy(field, direction));
        if (Number.isFinite(maxItems) && maxItems > 0) {
          constraints.push(limitDocs(maxItems));
        }

        try {
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
          if (constraints.length === 0) throw error;
          const snapshot = await getDocs(ref);
          let items = snapshot.docs.map((document) =>
            normalizeDoc(document.id, document.data())
          );
          items = sortInMemory(items, sort);
          return limitInMemory(items, maxItems);
        }
      });
    },

    async get(id) {
      if (!id) return null;

      const cachedFullList = readEntityCache(getFullListCacheKey(entityName));
      if (cachedFullList) {
        return cachedFullList.find((item) => item.id === id) || null;
      }

      const cacheKey = getEntityCacheKey(entityName, "get", id);
      return runCachedEntityRequest(entityName, cacheKey, async () => {
        const snapshot = await getDoc(doc(db, COLLECTIONS[entityName], id));
        return snapshot.exists()
          ? normalizeDoc(snapshot.id, snapshot.data())
          : null;
      });
    },

    async filter(filters = {}) {
      const filterEntries = Object.entries(filters).filter(
        ([, value]) => value !== undefined
      );

      if (filterEntries.length === 0) {
        return api.list();
      }

      const cachedFullList = readEntityCache(getFullListCacheKey(entityName));
      if (cachedFullList) {
        return cachedFullList.filter((item) =>
          filterEntries.every(([key, value]) => item?.[key] === value)
        );
      }

      const normalizedFilters = Object.fromEntries(
        [...filterEntries].sort(([a], [b]) => a.localeCompare(b))
      );
      const cacheKey = getEntityCacheKey(
        entityName,
        "filter",
        JSON.stringify(normalizedFilters)
      );

      return runCachedEntityRequest(entityName, cacheKey, async () => {
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
      });
    },

    async create(payload) {
      const now = new Date().toISOString();
      const currentUser = auth.currentUser;
      if (!currentUser) {
        const error = new Error("Authentication required");
        error.status = 401;
        throw error;
      }
      const sanitizedPayload = sanitizeForFirestore(payload || {});

      const data = {
        ...sanitizedPayload,
        created_date: sanitizedPayload.created_date || now,
        updated_date: now,
        created_at: serverTimestamp(),
        updated_at: serverTimestamp(),
      };

      if (entityName === "Ticket" && !data.created_by && currentUser.email) {
        data.created_by = currentUser.email;
      }

      const documentRef = await addDoc(ref, data);
      const created = normalizeDoc(documentRef.id, data);
      updateCachedFullList(entityName, (items) => [...items, created]);
      return created;
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
      const updated = normalizeDoc(id, data);
      updateCachedFullList(entityName, (items) =>
        items.map((item) => (item.id === id ? { ...item, ...updated } : item))
      );
      return updated;
    },

    async delete(id) {
      if (!id) {
        throw new Error(`ID mancante per delete su ${entityName}`);
      }

      await deleteDoc(doc(db, COLLECTIONS[entityName], id));
      updateCachedFullList(entityName, (items) =>
        items.filter((item) => item.id !== id)
      );
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
    const updatedUser = { ...user, ...normalizeValue(data) };
    cachedUserProfile = {
      uid: user.id,
      data: updatedUser,
      expiresAt: Date.now() + ENTITY_CACHE_TTL_MS.User,
    };
    updateCachedFullList("User", (items) =>
      items.map((item) => (item.id === user.id ? updatedUser : item))
    );
    return updatedUser;
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
    cachedUserProfile = null;
    userProfileRequestInFlight = null;
    entityRequestCache.clear();
    entityRequestsInFlight.clear();
    entityCacheVersions.clear();
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
