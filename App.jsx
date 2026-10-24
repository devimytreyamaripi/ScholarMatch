
import { useEffect, useMemo, useState } from "react";
import "./App.css";
import scholarships from "./Data/scholarships.js";
import { auth, db } from "./firebase";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  updateProfile,
} from "firebase/auth";
import { doc, getDoc, setDoc } from "firebase/firestore";

const initialProfile = {
  fullName: "",
  education: "",
  state: "Andhra Pradesh",
  category: "General",
  gender: "Prefer not to say",
  annualIncome: "",
  marks: "",
};

const educationOptions = [
  { value: "School", label: "10th / School" },
  { value: "Intermediate", label: "Intermediate (11th–12th)" },
  { value: "Diploma", label: "Diploma" },
  { value: "UG", label: "UG / Undergraduate" },
  { value: "PG", label: "PG / Postgraduate" },
  { value: "PhD", label: "PhD / Research" },
];

const normalize = (value) =>
  String(value ?? "").trim().toLowerCase();

const getArray = (value, fallback = []) => {
  if (Array.isArray(value)) return value;
  if (value == null || value === "") return fallback;
  return [value];
};

const isUnrestricted = (values) =>
  values.length === 0 ||
  values.some((value) =>
    ["all", "all india", "india", "any"].includes(normalize(value))
  );

const matchesSelection = (values, selected) => {
  const list = getArray(values, ["All"]);

  if (isUnrestricted(list)) return true;
  if (!selected) return false;

  return list.some(
    (value) => normalize(value) === normalize(selected)
  );
};

// User-friendly messages for Firebase and Firestore errors.
function getAuthErrorMessage(error, action = "login") {
  const code = error?.code || "";

  const messages = {
    "auth/email-already-in-use":
      "This email is already registered. Please log in.",
    "auth/invalid-email":
      "Please enter a valid email address.",
    "auth/weak-password":
      "Password must have at least 6 characters.",
    "auth/network-request-failed":
      "Network problem. Please check your internet connection.",
    "auth/operation-not-allowed":
      "Email and password login is not enabled in Firebase settings.",
    "auth/invalid-credential":
      "Incorrect email or password.",
    "auth/user-not-found":
      "No account found with these details. Please register first.",
    "auth/wrong-password":
      "Incorrect email or password.",
    "auth/too-many-requests":
      "Too many attempts. Please wait and try again.",
    "auth/user-disabled":
      "This account is disabled. Please contact support.",
    "auth/requires-recent-login":
      "Please log in again and retry.",
    "auth/account-exists-with-different-credential":
      "An account already exists with a different sign-in method.",
    "permission-denied":
      "Permission denied. Check your Firebase Firestore rules.",
    "unavailable":
      "The service is temporarily unavailable. Please try again.",
    "deadline-exceeded":
      "The request took too long. Please try again.",
    "unauthenticated":
      "Your session has expired. Please log in again.",
  };

  if (messages[code]) return messages[code];

  if (action === "register") {
    return "Registration could not be completed. Please try again.";
  }

  if (action === "logout") {
    return "Could not log out. Please try again.";
  }

  if (action === "data") {
    return "Could not load your account data. Check your connection and try again.";
  }

  if (action === "profile") {
    return "Could not save your profile. Please try again.";
  }

  return "Login failed. Please check your details and try again.";
}

// Profile compatibility score, not official eligibility confirmation.
function getMatchPercentage(item, profile) {
  let totalWeight = 0;
  let matchedWeight = 0;

  const addCriterion = (weight, isMatch) => {
    totalWeight += weight;
    if (isMatch) matchedWeight += weight;
  };

  const levels = getArray(
    item.levels ?? item.educationLevels ?? item.eligibleLevels
  );

  if (levels.length > 0 && profile.education) {
    addCriterion(30, matchesSelection(levels, profile.education));
  }

  const categories = getArray(
    item.categories ?? item.eligibleCategories,
    ["All"]
  );

  if (!isUnrestricted(categories) && profile.category) {
    addCriterion(20, matchesSelection(categories, profile.category));
  }

  const states = getArray(
    item.states ?? item.eligibleStates,
    ["All"]
  );

  if (!isUnrestricted(states) && profile.state) {
    addCriterion(10, matchesSelection(states, profile.state));
  }

  const schemeGender = normalize(item.gender ?? "All");
  const studentGender = normalize(profile.gender);

  if (
    schemeGender &&
    !["all", "any"].includes(schemeGender) &&
    studentGender &&
    !["prefer not to say", "rather not say"].includes(studentGender)
  ) {
    addCriterion(15, schemeGender === studentGender);
  }

  const maxIncome = item.maxIncome ?? item.maxAnnualIncome;

  if (
    maxIncome !== null &&
    maxIncome !== undefined &&
    maxIncome !== "" &&
    Number.isFinite(Number(maxIncome)) &&
    profile.annualIncome !== ""
  ) {
    const income = Number(profile.annualIncome);

    addCriterion(
      15,
      Number.isFinite(income) &&
        income >= 0 &&
        income <= Number(maxIncome)
    );
  }

  const rawMinMarks = item.minMarks;
  const minMarks =
    rawMinMarks == null ? null : Number(rawMinMarks);

  if (
    minMarks !== null &&
    Number.isFinite(minMarks) &&
    minMarks > 0 &&
    profile.marks !== ""
  ) {
    const marks = Number(profile.marks);

    addCriterion(
      10,
      Number.isFinite(marks) &&
        marks >= 0 &&
        marks <= 100 &&
        marks >= minMarks
    );
  }

  if (totalWeight === 0) return null;

  return Math.round((matchedWeight / totalWeight) * 100);
}

function needsAdditionalChecks(item) {
  return Boolean(
    item.requiresTechnicalCourse ||
      item.requiresDisabilityStatus ||
      item.requiresSpecificBeneficiary ||
      item.isDirectory
  );
}

function getMatchLabel(item, profile) {
  if (item.isDirectory) {
    return "Explore Scholarship Opportunities";
  }

  if (needsAdditionalChecks(item)) {
    return "Eligibility Verification Recommended";
  }

  const score = getMatchPercentage(item, profile);

  if (score === null) {
    return "Check Scholarship Requirements";
  }

  return `${score}% Profile Match`;
}

function App() {
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [dataLoading, setDataLoading] = useState(false);

  const [page, setPage] = useState("login");
  const [isRegistering, setIsRegistering] = useState(false);

  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [registerName, setRegisterName] = useState("");
  const [registerEmail, setRegisterEmail] = useState("");
  const [registerPassword, setRegisterPassword] = useState("");
  const [authMessage, setAuthMessage] = useState("");
  const [authBusy, setAuthBusy] = useState(false);

  const [profile, setProfile] = useState(initialProfile);
  const [profileSaved, setProfileSaved] = useState(false);
  const [savedIds, setSavedIds] = useState([]);
  const [applications, setApplications] = useState([]);

  const [search, setSearch] = useState("");
  const [levelFilter, setLevelFilter] = useState("All");
  const [categoryFilter, setCategoryFilter] = useState("All");

  const [applicationName, setApplicationName] = useState("");
  const [applicationStatus, setApplicationStatus] = useState("Planning");
  const [message, setMessage] = useState("");
  const [profileBusy, setProfileBusy] = useState(false);
  const [applicationBusy, setApplicationBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const unsubscribe = onAuthStateChanged(
      auth,
      async (firebaseUser) => {
        if (cancelled) return;

        setUser(firebaseUser);
        setMessage("");
        setAuthMessage("");

        if (!firebaseUser) {
          setProfile(initialProfile);
          setProfileSaved(false);
          setSavedIds([]);
          setApplications([]);
          setPage("login");
          setDataLoading(false);
          setAuthLoading(false);
          return;
        }

        setDataLoading(true);

        try {
          const userRef = doc(db, "users", firebaseUser.uid);
          const snapshot = await getDoc(userRef);

          if (cancelled) return;

          if (snapshot.exists()) {
            const data = snapshot.data();

            const loadedProfile = {
              ...initialProfile,
              ...(data.profile || {}),
              fullName:
                data.profile?.fullName ||
                firebaseUser.displayName ||
                data.name ||
                "",
            };

            setProfile(loadedProfile);

            setProfileSaved(
              Boolean(
                loadedProfile.education &&
                  loadedProfile.annualIncome !== "" &&
                  loadedProfile.marks !== ""
              )
            );

            setSavedIds(
              Array.isArray(data.savedIds) ? data.savedIds : []
            );

            setApplications(
              Array.isArray(data.applications)
                ? data.applications
                : []
            );
          } else {
            const newProfile = {
              ...initialProfile,
              fullName: firebaseUser.displayName || "",
            };

            await setDoc(userRef, {
              name: firebaseUser.displayName || "",
              email: firebaseUser.email || "",
              profile: newProfile,
              savedIds: [],
              applications: [],
            });

            if (cancelled) return;

            setProfile(newProfile);
            setProfileSaved(false);
            setSavedIds([]);
            setApplications([]);
          }

          setPage("dashboard");
        } catch (error) {
          console.error("Loading user data failed:", error);

          if (!cancelled) {
            setMessage(getAuthErrorMessage(error, "data"));
            setPage("dashboard");
          }
        } finally {
          if (!cancelled) {
            setDataLoading(false);
            setAuthLoading(false);
          }
        }
      }
    );

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  async function register(e) {
    e.preventDefault();

    if (authBusy) return;

    setAuthMessage("");

    const name = registerName.trim();
    const email = registerEmail.trim().toLowerCase();
    const password = registerPassword;

    if (!name) {
      setAuthMessage("Please enter your full name.");
      return;
    }

    if (!email) {
      setAuthMessage("Please enter your email address.");
      return;
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setAuthMessage("Please enter a valid email address.");
      return;
    }

    if (!password) {
      setAuthMessage("Please enter a password.");
      return;
    }

    if (password.length < 6) {
      setAuthMessage("Password must have at least 6 characters.");
      return;
    }

    setAuthBusy(true);
    let createdUser = null;

    try {
      const result = await createUserWithEmailAndPassword(
        auth,
        email,
        password
      );

      createdUser = result.user;

      await updateProfile(createdUser, {
        displayName: name,
      });

      const newProfile = {
        ...initialProfile,
        fullName: name,
      };

      await setDoc(doc(db, "users", createdUser.uid), {
        name,
        email: createdUser.email || email,
        profile: newProfile,
        savedIds: [],
        applications: [],
      });

      setProfile(newProfile);
      setProfileSaved(false);
      setSavedIds([]);
      setApplications([]);
      setPage("profile");

      setRegisterName("");
      setRegisterEmail("");
      setRegisterPassword("");
      setAuthMessage("");
      setMessage("Account created successfully. Complete your profile.");
    } catch (error) {
      console.error("Registration failed:", error);

      if (createdUser) {
        setAuthMessage(
          "Your account was created, but profile setup could not finish. Please check your internet connection and try logging in again."
        );
      } else {
        setAuthMessage(getAuthErrorMessage(error, "register"));
      }
    } finally {
      setAuthBusy(false);
    }
  }

  async function login(e) {
    e.preventDefault();

    if (authBusy) return;

    setAuthMessage("");

    const email = loginEmail.trim().toLowerCase();
    const password = loginPassword;

    if (!email) {
      setAuthMessage("Please enter your email address.");
      return;
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setAuthMessage("Please enter a valid email address.");
      return;
    }

    if (!password) {
      setAuthMessage("Please enter your password.");
      return;
    }

    setAuthBusy(true);

    try {
      await signInWithEmailAndPassword(auth, email, password);
      setLoginPassword("");
      setAuthMessage("");
    } catch (error) {
      console.error("Login failed:", error);
      setAuthMessage(getAuthErrorMessage(error, "login"));
    } finally {
      setAuthBusy(false);
    }
  }

  async function logout() {
    try {
      await signOut(auth);
      setPage("login");
      setIsRegistering(false);
      setLoginEmail("");
      setLoginPassword("");
      setMessage("");
      setAuthMessage("");
    } catch (error) {
      console.error("Logout failed:", error);
      setMessage(getAuthErrorMessage(error, "logout"));
    }
  }

  async function updateUserData(changes) {
    if (!auth.currentUser) {
      throw new Error("Please log in again.");
    }

    await setDoc(
      doc(db, "users", auth.currentUser.uid),
      {
        email: auth.currentUser.email || "",
        ...changes,
      },
      { merge: true }
    );
  }

  const matchedScholarships = useMemo(() => {
    const allScholarships = Array.isArray(scholarships)
      ? scholarships
      : [];

    if (
      !profileSaved ||
      !profile.education ||
      profile.annualIncome === "" ||
      profile.marks === ""
    ) {
      return [];
    }

    const income = Number(profile.annualIncome);
    const marks = Number(profile.marks);
    const query = normalize(search);

    if (
      !Number.isFinite(income) ||
      income < 0 ||
      !Number.isFinite(marks) ||
      marks < 0 ||
      marks > 100
    ) {
      return [];
    }

    return allScholarships
      .filter((item) => {
        if (!item) return false;

        const levels = getArray(
          item.levels ?? item.educationLevels ?? item.eligibleLevels
        );

        const categories = getArray(
          item.categories ?? item.eligibleCategories,
          ["All"]
        );

        const states = getArray(
          item.states ?? item.eligibleStates,
          ["All"]
        );

        const maxIncome = item.maxIncome ?? item.maxAnnualIncome;
        const rawMinMarks = item.minMarks;
        const minMarks =
          rawMinMarks == null ? null : Number(rawMinMarks);

        const name = String(item.name ?? item.title ?? "");
        const description = String(item.description ?? "");
        const link = item.link ?? item.officialLink ?? item.url ?? "";

        const levelMatch = matchesSelection(levels, profile.education);
        const categoryMatch = matchesSelection(
          categories,
          profile.category
        );
        const stateMatch = matchesSelection(states, profile.state);

        const schemeGender = normalize(item.gender ?? "All");
        const studentGender = normalize(profile.gender);

        const genderMatch =
          !schemeGender ||
          ["all", "any"].includes(schemeGender) ||
          !studentGender ||
          ["prefer not to say", "rather not say"].includes(
            studentGender
          ) ||
          schemeGender === studentGender;

        const incomeMatch =
          maxIncome == null ||
          maxIncome === "" ||
          !Number.isFinite(Number(maxIncome)) ||
          income <= Number(maxIncome);

        const marksMatch =
          minMarks === null ||
          !Number.isFinite(minMarks) ||
          minMarks <= 0 ||
          marks >= minMarks;

        const searchMatch =
          !query ||
          normalize(
            `${name} ${description} ${item.provider ?? ""} ${
              item.category ?? ""
            }`
          ).includes(query);

        const filterLevelMatch =
          levelFilter === "All" ||
          matchesSelection(levels, levelFilter);

        const filterCategoryMatch =
          categoryFilter === "All" ||
          matchesSelection(categories, categoryFilter);

        return (
          levelMatch &&
          categoryMatch &&
          stateMatch &&
          genderMatch &&
          incomeMatch &&
          marksMatch &&
          searchMatch &&
          filterLevelMatch &&
          filterCategoryMatch &&
          Boolean(link)
        );
      })
      .sort((a, b) => {
        const scoreA = getMatchPercentage(a, profile) ?? -1;
        const scoreB = getMatchPercentage(b, profile) ?? -1;
        return scoreB - scoreA;
      });
  }, [profile, profileSaved, search, levelFilter, categoryFilter]);

  async function saveProfile(e) {
    e.preventDefault();
    if (profileBusy) return;

    setMessage("");

    if (!profile.fullName.trim()) {
      setMessage("Please enter your full name.");
      return;
    }

    if (!profile.education) {
      setMessage("Please select your education level.");
      return;
    }

    if (profile.annualIncome === "" || profile.marks === "") {
      setMessage("Please enter annual family income and marks.");
      return;
    }

    const income = Number(profile.annualIncome);
    const marks = Number(profile.marks);

    if (!Number.isFinite(income) || income < 0) {
      setMessage("Enter a valid annual family income.");
      return;
    }

    if (!Number.isFinite(marks) || marks < 0 || marks > 100) {
      setMessage("Marks percentage must be between 0 and 100.");
      return;
    }

    setProfileBusy(true);

    try {
      const updatedProfile = {
        ...profile,
        fullName: profile.fullName.trim(),
      };

      await updateUserData({
        name: updatedProfile.fullName,
        profile: updatedProfile,
      });

      setProfile(updatedProfile);
      setProfileSaved(true);
      setMessage("Profile saved successfully! Matches are updated.");
    } catch (error) {
      console.error("Saving profile failed:", error);
      setMessage(getAuthErrorMessage(error, "profile"));
    } finally {
      setProfileBusy(false);
    }
  }

  async function toggleSave(id) {
    const nextIds = savedIds.includes(id)
      ? savedIds.filter((savedId) => savedId !== id)
      : [...savedIds, id];

    try {
      await updateUserData({ savedIds: nextIds });
      setSavedIds(nextIds);
      setMessage("");
    } catch (error) {
      console.error("Saving scholarship failed:", error);
      setMessage("Could not save scholarship. Please try again.");
    }
  }

  async function addApplication(e) {
    e.preventDefault();

    if (applicationBusy) return;

    if (!applicationName.trim()) {
      setMessage("Enter a scholarship name.");
      return;
    }

    const nextApplications = [
      ...applications,
      {
        id: Date.now(),
        name: applicationName.trim(),
        status: applicationStatus,
      },
    ];

    setApplicationBusy(true);

    try {
      await updateUserData({ applications: nextApplications });
      setApplications(nextApplications);
      setApplicationName("");
      setApplicationStatus("Planning");
      setMessage("Application added successfully.");
    } catch (error) {
      console.error("Adding application failed:", error);
      setMessage("Could not add application. Please try again.");
    } finally {
      setApplicationBusy(false);
    }
  }

  async function updateApplication(id, status) {
    const nextApplications = applications.map((item) =>
      item.id === id ? { ...item, status } : item
    );

    try {
      await updateUserData({ applications: nextApplications });
      setApplications(nextApplications);
      setMessage("Application status updated.");
    } catch (error) {
      console.error("Updating application failed:", error);
      setMessage("Could not update application status.");
    }
  }

  async function deleteApplication(id) {
    const nextApplications = applications.filter(
      (item) => item.id !== id
    );

    try {
      await updateUserData({ applications: nextApplications });
      setApplications(nextApplications);
      setMessage("Application deleted.");
    } catch (error) {
      console.error("Deleting application failed:", error);
      setMessage("Could not delete application.");
    }
  }

  function renderScholarshipCards(items) {
    if (items.length === 0) {
      return (
        <div className="empty-state">
          <h3>No matching scholarships found</h3>
          <p>
            Try changing your search or filters, or check official scholarship
            websites for more opportunities.
          </p>

          <button
            type="button"
            className="secondary-btn"
            onClick={() => {
              setSearch("");
              setLevelFilter("All");
              setCategoryFilter("All");
            }}
          >
            Clear Filters
          </button>

          <p>
            <a
              href="https://scholarships.gov.in/"
              target="_blank"
              rel="noreferrer"
            >
              National Scholarship Portal ↗
            </a>
          </p>
        </div>
      );
    }

    return (
      <div className="scholarship-grid">
        {items.map((item, index) => {
          const itemId = item.id ?? item.name ?? item.title ?? index;
          const name = item.name ?? item.title ?? "Scholarship";
          const description = item.description ?? "";
          const levels = getArray(
            item.levels ?? item.educationLevels ?? item.eligibleLevels
          );
          const maxIncome = item.maxIncome ?? item.maxAnnualIncome;
          const link = item.link ?? item.officialLink ?? item.url ?? "#";
          const matchPercentage = getMatchPercentage(item, profile);
          const additionalChecks = needsAdditionalChecks(item);

          return (
            <article className="scholarship-card" key={itemId}>
              <div className="card-top">
                <span className="scholarship-icon">🎓</span>

                <button
                  type="button"
                  className={`save-btn ${
                    savedIds.includes(itemId) ? "is-saved" : ""
                  }`}
                  onClick={() => toggleSave(itemId)}
                >
                  {savedIds.includes(itemId) ? "♥ Saved" : "♡ Save"}
                </button>
              </div>

              <p className="match-score">{getMatchLabel(item, profile)}</p>

              <h3>{name}</h3>
              <p>{description}</p>

              <div className="scholarship-meta">
                <span>
                  {levels.length
                    ? levels.join(", ")
                    : "Check scheme requirements"}
                </span>

                {maxIncome != null && maxIncome !== "" && (
                  <span>
                    Income limit: ₹
                    {Number(maxIncome).toLocaleString("en-IN")}
                  </span>
                )}
              </div>

              {additionalChecks && (
                <p className="verification-note">
                  Please review the official scholarship requirements before
                  applying.
                </p>
              )}

              {!additionalChecks && matchPercentage !== null && (
                <p className="verification-note">
                  This is a preliminary profile match, not an official
                  eligibility confirmation.
                </p>
              )}

              <div className="card-actions">
                <button
                  type="button"
                  className="secondary-btn"
                  onClick={() => {
                    setMessage(
                      `${name}: ${getMatchLabel(
                        item,
                        profile
                      )}. Please verify the official requirements.`
                    );
                    setPage("eligibility");
                  }}
                >
                  View Match
                </button>

                <a href={link} target="_blank" rel="noreferrer">
                  Official Details ↗
                </a>
              </div>
            </article>
          );
        })}
      </div>
    );
  }

  if (authLoading || dataLoading) {
    return (
      <main className="auth-page">
        <section className="auth-card">
          <h1>ScholarMatch</h1>
          <p>Loading your account...</p>
        </section>
      </main>
    );
  }

  if (!user) {
    return (
      <main className="auth-page">
        <section className="auth-card">
          <div className="auth-logo">🎓</div>
          <h1>ScholarMatch</h1>
          <p className="auth-subtitle">
            Find scholarship opportunities for your education journey.
          </p>

          <div className="auth-tabs">
            <button
              type="button"
              className={!isRegistering ? "active" : ""}
              onClick={() => {
                setIsRegistering(false);
                setAuthMessage("");
              }}
            >
              Login
            </button>

            <button
              type="button"
              className={isRegistering ? "active" : ""}
              onClick={() => {
                setIsRegistering(true);
                setAuthMessage("");
              }}
            >
              Register
            </button>
          </div>

          {authMessage && (
            <p className="message error" role="alert">
              {authMessage}
            </p>
          )}

          {isRegistering ? (
            <form className="auth-form" onSubmit={register}>
              <label htmlFor="register-name">Full Name</label>
              <input
                id="register-name"
                value={registerName}
                onChange={(e) => setRegisterName(e.target.value)}
                placeholder="Enter your full name"
                autoComplete="name"
                maxLength={100}
                required
                disabled={authBusy}
              />

              <label htmlFor="register-email">Email</label>
              <input
                id="register-email"
                type="email"
                value={registerEmail}
                onChange={(e) => setRegisterEmail(e.target.value)}
                placeholder="Enter your email"
                autoComplete="email"
                required
                disabled={authBusy}
              />

              <label htmlFor="register-password">Password</label>
              <input
                id="register-password"
                type="password"
                value={registerPassword}
                onChange={(e) => setRegisterPassword(e.target.value)}
                placeholder="At least 6 characters"
                autoComplete="new-password"
                minLength={6}
                required
                disabled={authBusy}
              />

              <button
                className="primary-btn"
                type="submit"
                disabled={authBusy}
              >
                {authBusy ? "Creating Account..." : "Create Account"}
              </button>
            </form>
          ) : (
            <form className="auth-form" onSubmit={login}>
              <label htmlFor="login-email">Email</label>
              <input
                id="login-email"
                type="email"
                value={loginEmail}
                onChange={(e) => setLoginEmail(e.target.value)}
                placeholder="Registered email"
                autoComplete="email"
                required
                disabled={authBusy}
              />

              <label htmlFor="login-password">Password</label>
              <input
                id="login-password"
                type="password"
                value={loginPassword}
                onChange={(e) => setLoginPassword(e.target.value)}
                placeholder="Your password"
                autoComplete="current-password"
                required
                disabled={authBusy}
              />

              <button
                className="primary-btn"
                type="submit"
                disabled={authBusy}
              >
                {authBusy ? "Logging in..." : "Login"}
              </button>
            </form>
          )}

          <p className="auth-footer">
            Always verify eligibility on the official scholarship website.
          </p>
        </section>
      </main>
    );
  }

  const savedScholarships = (
    Array.isArray(scholarships) ? scholarships : []
  ).filter((item, index) =>
    savedIds.includes(item.id ?? item.name ?? item.title ?? index)
  );

  return (
    <div className="app-container">
      <header className="navbar">
        <button
          type="button"
          className="brand"
          onClick={() => setPage("dashboard")}
        >
          🎓 ScholarMatch
        </button>

        <nav className="nav-links">
          {[
            ["dashboard", "Dashboard"],
            ["scholarships", "My Matches"],
            ["eligibility", "Eligibility"],
            ["saved", "Saved"],
            ["tracker", "Tracker"],
            ["profile", "Profile"],
            ["guidance", "Guidance"],
          ].map(([id, label]) => (
            <button
              type="button"
              key={id}
              className={page === id ? "nav-active" : ""}
              onClick={() => {
                setPage(id);
                setMessage("");
              }}
            >
              {label}
            </button>
          ))}
        </nav>

        <div className="user-actions">
          <span className="welcome-user">
            Hi, {profile.fullName || user.displayName || user.email}
          </span>

          <button className="logout-btn" onClick={logout} type="button">
            Logout
          </button>
        </div>
      </header>

      <main className="main-content">
        {page === "dashboard" && (
          <>
            <section className="hero-section">
              <div>
                <p className="eyebrow">YOUR SCHOLARSHIP COMPANION</p>
                <h1>
                  Welcome,{" "}
                  {profile.fullName || user.displayName || "Student"}! 👋
                </h1>
                <p>
                  Discover scholarship opportunities based on your profile.
                </p>

                <button
                  className="primary-btn"
                  type="button"
                  onClick={() =>
                    setPage(profileSaved ? "scholarships" : "profile")
                  }
                >
                  {profileSaved
                    ? "View My Matches"
                    : "Complete My Profile"}
                </button>
              </div>

              <div className="hero-icon">🎓</div>
            </section>

            <section className="stats-grid">
              <div className="stat-card">
                <span>📚</span>
                <h2>{matchedScholarships.length}</h2>
                <p>Matching Listings</p>
              </div>

              <div className="stat-card">
                <span>💛</span>
                <h2>{savedIds.length}</h2>
                <p>Saved Scholarships</p>
              </div>

              <div className="stat-card">
                <span>📝</span>
                <h2>{applications.length}</h2>
                <p>Tracked Applications</p>
              </div>
            </section>

            <section className="section">
              <h2>Scholarships Matching Your Profile</h2>
              <p>
                Match scores are preliminary and do not guarantee eligibility.
              </p>

              {!profileSaved ? (
                <div className="notice">
                  Complete your profile to find matching listings.
                  <button
                    className="primary-btn"
                    type="button"
                    onClick={() => setPage("profile")}
                  >
                    Complete Profile
                  </button>
                </div>
              ) : (
                renderScholarshipCards(matchedScholarships)
              )}
            </section>
          </>
        )}

        {page === "scholarships" && (
          <section className="section">
            <h1>My Scholarship Matches</h1>
            <p>
              Search and explore scholarship opportunities matching your profile.
            </p>

            <div className="filter-bar">
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search scholarships..."
              />

              <select
                value={levelFilter}
                onChange={(e) => setLevelFilter(e.target.value)}
              >
                <option value="All">All Levels</option>
                {educationOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>

              <select
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
              >
                <option value="All">All Categories</option>
                <option value="General">General</option>
                <option value="SC">SC</option>
                <option value="ST">ST</option>
                <option value="OBC">OBC</option>
                <option value="EWS">EWS</option>
              </select>
            </div>

            {!profileSaved ? (
              <div className="notice">
                Save your profile to see personalized matches.
                <button
                  className="primary-btn"
                  type="button"
                  onClick={() => setPage("profile")}
                >
                  Open Profile
                </button>
              </div>
            ) : (
              renderScholarshipCards(matchedScholarships)
            )}
          </section>
        )}

        {page === "eligibility" && (
          <section className="section">
            <h1>Eligibility Results</h1>
            <p>
              Review each scheme's official requirements before applying.
            </p>

            {!profileSaved ? (
              <div className="notice">
                Complete your profile before checking matches.
                <button
                  className="primary-btn"
                  type="button"
                  onClick={() => setPage("profile")}
                >
                  Complete Profile
                </button>
              </div>
            ) : (
              renderScholarshipCards(matchedScholarships)
            )}

            <p>
              <a
                href="https://scholarships.gov.in/"
                target="_blank"
                rel="noreferrer"
              >
                National Scholarship Portal ↗
              </a>
            </p>
          </section>
        )}

        {page === "saved" && (
          <section className="section">
            <h1>Saved Scholarships</h1>
            <p>Your bookmarked scholarship opportunities.</p>

            {savedScholarships.length === 0 ? (
              <div className="empty-state">
                <h3>No saved scholarships yet</h3>
                <p>Open My Matches and click Save on a scholarship.</p>
                <button
                  className="primary-btn"
                  type="button"
                  onClick={() => setPage("scholarships")}
                >
                  View My Matches
                </button>
              </div>
            ) : (
              renderScholarshipCards(savedScholarships)
            )}
          </section>
        )}

        {page === "tracker" && (
          <section className="section">
            <h1>Application Tracker</h1>
            <p>Keep track of your scholarship application progress.</p>

            <form className="tracker-form" onSubmit={addApplication}>
              <input
                value={applicationName}
                onChange={(e) => setApplicationName(e.target.value)}
                placeholder="Scholarship name"
                maxLength={200}
                required
              />

              <select
                value={applicationStatus}
                onChange={(e) => setApplicationStatus(e.target.value)}
              >
                <option>Planning</option>
                <option>Documents Preparing</option>
                <option>Applied</option>
                <option>Under Review</option>
                <option>Approved</option>
                <option>Rejected</option>
              </select>

              <button
                className="primary-btn"
                type="submit"
                disabled={applicationBusy}
              >
                {applicationBusy ? "Adding..." : "Add Application"}
              </button>
            </form>

            {applications.length > 0 ? (
              <div className="table-wrapper">
                <table>
                  <thead>
                    <tr>
                      <th>Scholarship</th>
                      <th>Status</th>
                      <th>Action</th>
                    </tr>
                  </thead>

                  <tbody>
                    {applications.map((item) => (
                      <tr key={item.id}>
                        <td>{item.name}</td>
                        <td>
                          <select
                            value={item.status}
                            onChange={(e) =>
                              updateApplication(item.id, e.target.value)
                            }
                          >
                            <option>Planning</option>
                            <option>Documents Preparing</option>
                            <option>Applied</option>
                            <option>Under Review</option>
                            <option>Approved</option>
                            <option>Rejected</option>
                          </select>
                        </td>
                        <td>
                          <button
                            type="button"
                            className="delete-btn"
                            onClick={() => deleteApplication(item.id)}
                          >
                            Delete
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="empty-state">
                <h3>No applications added</h3>
                <p>Add an application above to start tracking.</p>
              </div>
            )}
          </section>
        )}

        {page === "profile" && (
          <section className="section profile-section">
            <h1>My Student Profile</h1>
            <p>
              Enter your details and save to refresh your scholarship matches.
            </p>

            <form className="profile-form" onSubmit={saveProfile}>
              <label>Full Name</label>
              <input
                value={profile.fullName}
                onChange={(e) =>
                  setProfile({ ...profile, fullName: e.target.value })
                }
                placeholder="Enter your full name"
                maxLength={100}
                required
              />

              <label>Education Level</label>
              <select
                value={profile.education}
                onChange={(e) =>
                  setProfile({ ...profile, education: e.target.value })
                }
                required
              >
                <option value="">Select education level</option>
                {educationOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>

              <label>State</label>
              <select
                value={profile.state}
                onChange={(e) =>
                  setProfile({ ...profile, state: e.target.value })
                }
              >
                <option>Andhra Pradesh</option>
                <option>Telangana</option>
                <option>Tamil Nadu</option>
                <option>Karnataka</option>
                <option>Kerala</option>
                <option>Maharashtra</option>
                <option>Other</option>
              </select>

              <label>Category</label>
              <select
                value={profile.category}
                onChange={(e) =>
                  setProfile({ ...profile, category: e.target.value })
                }
              >
                <option>General</option>
                <option>SC</option>
                <option>ST</option>
                <option>OBC</option>
                <option>EWS</option>
              </select>

              <label>Gender</label>
              <select
                value={profile.gender}
                onChange={(e) =>
                  setProfile({ ...profile, gender: e.target.value })
                }
              >
                <option>Prefer not to say</option>
                <option>Female</option>
                <option>Male</option>
                <option>Other</option>
              </select>

              <label>Annual Family Income (₹)</label>
              <input
                type="number"
                min="0"
                value={profile.annualIncome}
                onChange={(e) =>
                  setProfile({ ...profile, annualIncome: e.target.value })
                }
                placeholder="Example: 200000"
                required
              />

              <label>Marks Percentage</label>
              <input
                type="number"
                min="0"
                max="100"
                step="0.01"
                value={profile.marks}
                onChange={(e) =>
                  setProfile({ ...profile, marks: e.target.value })
                }
                placeholder="Example: 85"
                required
              />

              <button
                className="primary-btn"
                type="submit"
                disabled={profileBusy}
              >
                {profileBusy ? "Saving Profile..." : "Save Profile & Find Matches"}
              </button>
            </form>
          </section>
        )}

        {page === "guidance" && (
          <section className="section">
            <h1>Application Guidance</h1>

            <div className="guidance-list">
              <article>
                <span>1</span>
                <div>
                  <h3>Complete your profile</h3>
                  <p>Enter your correct education and student details.</p>
                </div>
              </article>

              <article>
                <span>2</span>
                <div>
                  <h3>Explore scholarships</h3>
                  <p>Review the matching listings and their requirements.</p>
                </div>
              </article>

              <article>
                <span>3</span>
                <div>
                  <h3>Verify eligibility</h3>
                  <p>Check deadlines, course rules and required documents.</p>
                </div>
              </article>

              <article>
                <span>4</span>
                <div>
                  <h3>Apply through official websites</h3>
                  <p>Submit correct details through the official portal.</p>
                </div>
              </article>
            </div>

            <div className="official-links">
              <h2>Official Websites</h2>

              <a
                href="https://scholarships.gov.in/"
                target="_blank"
                rel="noreferrer"
              >
                National Scholarship Portal ↗
              </a>

              <a
                href="https://www.myscheme.gov.in/"
                target="_blank"
                rel="noreferrer"
              >
                MyScheme Government Portal ↗
              </a>

              <a
                href="https://jnanabhumi.ap.gov.in/"
                target="_blank"
                rel="noreferrer"
              >
                Andhra Pradesh Jnanabhumi ↗
              </a>
            </div>
          </section>
        )}

        {message && (
          <p className="message" role="status">
            {message}
          </p>
        )}
      </main>

      <footer className="app-footer">
        <p>
          © 2026 ScholarMatch · Profile matches are preliminary and are not
          official eligibility decisions.
        </p>
      </footer>
    </div>
  );
}

export default App;
