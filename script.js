// ============================================
// STUDYFLOW
// PDF SUMMARY | STUDY NOTES | ASK YOUR PDF
// ============================================

const MODEL = "llama3.2:1b";
const MAX_FILE_SIZE = 20 * 1024 * 1024;
const NOTES_PAGES_PER_BATCH = 2;

// Supabase browser configuration. The publishable key is designed for frontend use.
const SUPABASE_URL = "https://ejyqbiovippmwlodoxwz.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_SbNEvbASlfnSJ8Ss1ieWUQ_HVju-kEk";
// This temporary Cloudflare URL changes whenever a new quick tunnel is created.
const OLLAMA_URL = "https://chuck-fellowship-finds-regards.trycloudflare.com";

const supabaseClient = window.supabase.createClient(
    SUPABASE_URL,
    SUPABASE_PUBLISHABLE_KEY,
    { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } }
);

const authOverlay = document.getElementById("auth-overlay");
const authForm = document.getElementById("auth-form");
const authEmail = document.getElementById("auth-email");
const authPassword = document.getElementById("auth-password");
const authMessage = document.getElementById("auth-message");
const authSignupButton = document.getElementById("auth-signup");
let currentAccessToken = null;

function showAuthMessage(message, isError = false) {
    if (!authMessage) return;
    authMessage.textContent = message;
    authMessage.style.color = isError ? "#c03955" : "#6c6980";
}

function setAuthSession(session) {
    currentAccessToken = session?.access_token || null;
    if (authOverlay) authOverlay.style.display = currentAccessToken ? "none" : "flex";
    if (currentAccessToken) {
        setTimeout(() => {
            if (!document.getElementById("studyflow-logout")) {
                const topbar = document.querySelector(".topbar");
                if (topbar) {
                    const controls = document.createElement("div");
                    controls.id = "studyflow-account-controls";
                    controls.style.cssText = "display:flex;align-items:center;gap:10px;flex-wrap:wrap;";
                    const label = document.createElement("span");
                    label.textContent = "Signed in";
                    label.style.cssText = "font-size:13px;color:#6c6980;";
                    const button = document.createElement("button");
                    button.id = "studyflow-logout";
                    button.type = "button";
                    button.textContent = "Sign out";
                    button.style.cssText = "border:1px solid #ddd9ee;border-radius:9px;padding:8px 12px;background:#fff;cursor:pointer;font:inherit;";
                    button.addEventListener("click", async () => {
                        await supabaseClient.auth.signOut();
                        showAuthMessage("You have signed out.");
                    });
                    controls.append(label, button);
                    topbar.appendChild(controls);
                }
            }
        }, 0);
    } else {
        document.getElementById("studyflow-account-controls")?.remove();
    }
}

if (authForm) {
    authForm.addEventListener("submit", async event => {
        event.preventDefault();
        const email = authEmail.value.trim();
        const password = authPassword.value;
        const submitButton = document.getElementById("auth-signin");
        submitButton.disabled = true;
        authSignupButton.disabled = true;
        showAuthMessage("Signing you in...");
        try {
            const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
            if (error) throw error;
            setAuthSession(data.session);
            showAuthMessage("Signed in successfully.");
        } catch (error) {
            showAuthMessage(error.message || "Could not sign in.", true);
        } finally {
            submitButton.disabled = false;
            authSignupButton.disabled = false;
        }
    });
}

if (authSignupButton) {
    authSignupButton.addEventListener("click", async () => {
        const email = authEmail.value.trim();
        const password = authPassword.value;
        if (!email || !password) {
            showAuthMessage("Enter your email and password first.", true);
            return;
        }
        authSignupButton.disabled = true;
        showAuthMessage("Creating your account...");
        try {
            const { data, error } = await supabaseClient.auth.signUp({
                email,
                password,
                options: { emailRedirectTo: window.location.origin }
            });
            if (error) throw error;
            if (data.session) {
                setAuthSession(data.session);
                showAuthMessage("Account created. You're signed in.");
            } else {
                showAuthMessage("Account created! Check your email to confirm your account, then sign in.");
            }
        } catch (error) {
            showAuthMessage(error.message || "Could not create your account.", true);
        } finally {
            authSignupButton.disabled = false;
        }
    });
}

supabaseClient.auth.getSession().then(({ data }) => setAuthSession(data.session));
supabaseClient.auth.onAuthStateChange((_event, session) => setAuthSession(session));

if (window.pdfjsLib) {
    pdfjsLib.GlobalWorkerOptions.workerSrc =
        "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
}

const $ = id => document.getElementById(id);

const pdfInput = $("pdf-upload");
const uploadBox = $("upload-box");
const fileCount = $("file-count");
const documentInfo = $("document-info");
const statusMessage = $("status-message");
const workspace = $("workspace");
const workspaceTitle = $("workspace-title");
const workspaceDescription = $("workspace-description");
const askForm = $("ask-form");
const questionInput = $("question-input");
const generateButton = $("generate-btn");
const downloadButton = $("download-btn");
const resultBox = $("result-box");
const resultContent = $("result-content");
const resultType = $("result-type");

let selectedFile = null;
let extractedText = "";
let extractedPages = [];
let activeTool = "summarise";
let latestResult = "";
let isGenerating = false;
let isExtracting = false;
let extractionSequence = 0;

// ============================================
// TOOLS
// ============================================

const tools = {
    summarise: {
        title: "PDF Summary",
        description: "Turn lengthy study material into a clear, structured summary.",
        prompt: `Create an accurate summary of the actual PDF content below.
Use only the supplied source. Do not invent facts.
Preserve important definitions, theories, formulas, examples, names and terminology.
Use meaningful headings and bullet points.
Do not explain how to write a summary.
Return only the summary.`
    },

    notes: {
        title: "Study Notes",
        description: "Create organised, detailed revision notes from your document.",
        prompt: `Create detailed university-level study notes from the supplied source.
Explain the actual concepts clearly.
Preserve definitions, theories, formulas, assumptions, arguments, examples and terminology.
Use meaningful headings, subheadings and bullet points.
Do not invent information or introduce unrelated topics.
Do not use placeholders.
Do not add MCQs, flashcards or generic study advice.
Return readable Markdown.`
    },

    ask: {
        title: "Ask Your PDF",
        description: "Ask questions and get answers based on your document.",
        prompt: ""
    }
};

// ============================================
// STATUS AND DISPLAY
// ============================================

function setStatus(message, isError = false) {
    if (!statusMessage) return;

    statusMessage.textContent = message;
    statusMessage.style.color = isError ? "#c03955" : "";
}

function clearResult() {
    latestResult = "";

    if (resultContent) {
        resultContent.replaceChildren();
    }

    if (resultBox) {
        resultBox.classList.add("hidden");
    }

    if (downloadButton) {
        downloadButton.disabled = true;
    }
}

function addElement(parent, tag, text, className = "") {
    const element = document.createElement(tag);
    element.textContent = text || "";

    if (className) {
        element.className = className;
    }

    parent.appendChild(element);
    return element;
}

// ============================================
// TOOL SELECTION
// ============================================

function chooseTool(toolName) {
    if (!tools[toolName] || isGenerating) return;

    activeTool = toolName;

    document.querySelectorAll("[data-tab]").forEach(button => {
        const active = button.dataset.tab === toolName;

        button.classList.toggle("active", active);
        button.classList.toggle("selected", active);
    });

    if (workspaceTitle) {
        workspaceTitle.textContent = tools[toolName].title;
    }

    if (workspaceDescription) {
        workspaceDescription.textContent = tools[toolName].description;
    }

    if (askForm) {
        askForm.classList.toggle("hidden", toolName !== "ask");
    }

    if (workspace) {
        workspace.classList.remove("hidden");
    }

    if (generateButton) {
        generateButton.textContent =
            toolName === "ask" ? "✧ Ask AI" : "✧ Generate with AI";
    }

    clearResult();
}

document.querySelectorAll("[data-tab]").forEach(button => {
    button.addEventListener("click", () => {
        chooseTool(button.dataset.tab);
    });
});

// ============================================
// PDF EXTRACTION
// Keep PDF.js extraction compatible with the
// original project.
// ============================================

async function extractPdfPages(file) {
    if (!window.pdfjsLib) {
        throw new Error("PDF reader did not load. Refresh the page.");
    }

    const pdf = await pdfjsLib.getDocument({
        data: new Uint8Array(await file.arrayBuffer())
    }).promise;

    const pages = [];

    // First, try the normal PDF text reader.
    for (let number = 1; number <= pdf.numPages; number++) {
        setStatus(`Reading page ${number} of ${pdf.numPages}...`);

        const page = await pdf.getPage(number);
        const content = await page.getTextContent();

        const text = content.items
            .map(item => item.str || "")
            .filter(Boolean)
            .join(" ")
            .trim();

        pages.push({
            pageNumber: number,
            text
        });
    }

    // If normal extraction works, return immediately.
    if (pages.some(page => page.text.length > 0)) {
        return pages;
    }

    // Otherwise, load OCR automatically.
    setStatus("Reading scanned pages...");

    if (!window.Tesseract) {
        await new Promise((resolve, reject) => {
            const script = document.createElement("script");

            script.src =
                "https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js";

            script.onload = resolve;
            script.onerror = () => reject(
                new Error("Could not load OCR. Check your internet connection.")
            );

            document.head.appendChild(script);
        });
    }

    const worker = await Tesseract.createWorker("eng");

    try {
        for (let index = 0; index < pages.length; index++) {
            const pageNumber = pages[index].pageNumber;

            setStatus(
                `Reading scanned page ${pageNumber} of ${pages.length}...`
            );

            const page = await pdf.getPage(pageNumber);

            const viewport = page.getViewport({ scale: 1.5 });
            const canvas = document.createElement("canvas");

            canvas.width = Math.ceil(viewport.width);
            canvas.height = Math.ceil(viewport.height);

            await page.render({
                canvasContext: canvas.getContext("2d"),
                viewport
            }).promise;

            const result = await worker.recognize(canvas);

            pages[index].text = result.data.text.trim();

            canvas.width = 0;
            canvas.height = 0;
        }
    } finally {
        await worker.terminate();
    }

    if (!pages.some(page => page.text.length > 0)) {
        throw new Error(
            "Could not read text from this PDF. Please try another file."
        );
    }

    return pages;
}
// ============================================
// FILE UPLOAD
// ============================================

async function handleFile(file) {
    if (!file) return;

    if (isGenerating || isExtracting) {
        setStatus("Please wait for the current operation to finish.", true);
        return;
    }

    const isPdf =
        file.type === "application/pdf" ||
        file.name.toLowerCase().endsWith(".pdf");

    if (!isPdf) {
        setStatus("Please select a PDF file.", true);
        return;
    }

    if (file.size > MAX_FILE_SIZE) {
        setStatus("This version supports PDFs up to 20 MB.", true);
        return;
    }

    const sequence = ++extractionSequence;
    isExtracting = true;

    selectedFile = null;
    extractedText = "";
    extractedPages = [];

    clearResult();

    if (generateButton) {
        generateButton.disabled = true;
    }

    if (fileCount) {
        fileCount.textContent = file.name;
    }

    if (documentInfo) {
        documentInfo.classList.remove("hidden");
        documentInfo.textContent =
            `${file.name} · ${(file.size / (1024 * 1024)).toFixed(2)} MB`;
    }

    setStatus("Preparing your PDF for study tools...");

    try {
        const pages = await extractPdfPages(file);

        if (sequence !== extractionSequence) return;

        // Only pages containing actual text are sent to the AI.
        const readablePages = pages.filter(page => page.text.trim());

        if (!readablePages.length) {
            throw new Error(
                "PDF.js opened this PDF but extracted zero text characters. Check the console diagnostic."
            );
        }

        extractedPages = readablePages.map(page => ({
            pageNumber: page.pageNumber,
            text: page.text.trim()
        }));

        extractedText = extractedPages
            .map(page => `PAGE ${page.pageNumber}\n${page.text}`)
            .join("\n\n");

        if (!extractedText.trim()) {
            throw new Error("The extracted PDF text is empty.");
        }

        selectedFile = file;

        setStatus(
            `PDF ready! Extracted text from ${extractedPages.length} pages. Choose a study tool below.`
        );

    } catch (error) {
        if (sequence !== extractionSequence) return;

        selectedFile = null;
        extractedText = "";
        extractedPages = [];

        console.error("StudyFlow PDF error:", error);

        setStatus(error.message || "Could not read this PDF.", true);

    } finally {
        if (sequence === extractionSequence) {
            isExtracting = false;

            if (generateButton) {
                generateButton.disabled = false;
            }
        }
    }
}

if (pdfInput) {
    pdfInput.addEventListener("change", event => {
        handleFile(event.target.files?.[0]);
    });
}

// ============================================
// DRAG AND DROP
// ============================================

if (uploadBox) {
    ["dragenter", "dragover"].forEach(eventName => {
        uploadBox.addEventListener(eventName, event => {
            event.preventDefault();
            event.stopPropagation();

            if (event.dataTransfer) {
                event.dataTransfer.dropEffect = "copy";
            }

            uploadBox.classList.add("dragging");
        });
    });

    ["dragleave", "dragend"].forEach(eventName => {
        uploadBox.addEventListener(eventName, event => {
            event.preventDefault();
            event.stopPropagation();

            if (
                event.relatedTarget &&
                uploadBox.contains(event.relatedTarget)
            ) {
                return;
            }

            uploadBox.classList.remove("dragging");
        });
    });

    uploadBox.addEventListener("drop", event => {
        event.preventDefault();
        event.stopPropagation();

        uploadBox.classList.remove("dragging");

        const file = event.dataTransfer?.files?.[0];

        if (file) {
            handleFile(file);
        } else {
            setStatus("No file detected. Please try again.", true);
        }
    });
}

["dragenter", "dragover", "drop"].forEach(eventName => {
    document.addEventListener(eventName, event => {
        if (
            eventName === "drop" &&
            uploadBox &&
            uploadBox.contains(event.target)
        ) {
            return;
        }

        event.preventDefault();
    });
});

// ============================================
// OLLAMA REQUEST
// ============================================

async function generateWithOllama(prompt, options = {}) {
    let response;

    if (!currentAccessToken) {
        throw new Error("Please sign in to use StudyFlow AI.");
    }

    try {
        response = await fetch(OLLAMA_URL, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${currentAccessToken || ""}`
            },
            body: JSON.stringify({
                model: MODEL,
                prompt,
                stream: false,
                options: {
                    temperature: options.temperature ?? 0.1,
                    num_predict: options.numPredict ?? 1000,
                    num_ctx: 8192
                }
            })
        });
    } catch (error) {
        throw new Error(
            "Cannot connect to StudyFlow AI. Check that your laptop's proxy and Cloudflare tunnel are running."
        );
    }

    if (!response.ok) {
        throw new Error(
            `Ollama returned error ${response.status}. Check that ${MODEL} is installed.`
        );
    }

    const data = await response.json();

    const text =
        typeof data.response === "string"
            ? data.response
            : data.message?.content;

    if (!text || !text.trim()) {
        throw new Error("The AI returned an empty response. Please try again.");
    }

    return {
        text: text.trim(),
        doneReason: data.done_reason || "unknown"
    };
}

// ============================================
// NOTES: PAGE RECOVERY
// ============================================

function getPagesForNotes() {
    if (
        Array.isArray(extractedPages) &&
        extractedPages.some(page => page.text?.trim())
    ) {
        return extractedPages.filter(page => page.text?.trim());
    }

    // Fallback for documents whose page array is unavailable.
    if (extractedText.trim()) {
        const matches = [
            ...extractedText.matchAll(/(?:^|\n\n)PAGE\s+(\d+)\s*\n/g)
        ];

        if (matches.length) {
            return matches.map((match, index) => {
                const start = match.index + match[0].length;
                const end =
                    index + 1 < matches.length
                        ? matches[index + 1].index
                        : extractedText.length;

                return {
                    pageNumber: Number(match[1]),
                    text: extractedText.slice(start, end).trim()
                };
            }).filter(page => page.text);
        }

        return [{
            pageNumber: 1,
            text: extractedText.trim()
        }];
    }

    throw new Error(
        "No extracted PDF text is available. Upload the PDF again and wait until it says PDF ready."
    );
}

// ============================================
// STUDY NOTES: BATCH PROCESSING
// ============================================

function makeBatches(pages, size) {
    const batches = [];

    for (let index = 0; index < pages.length; index += size) {
        batches.push(pages.slice(index, index + size));
    }

    return batches;
}

async function generateNotesBatched() {
    const pages = getPagesForNotes();

    const batches = makeBatches(
        pages,
        NOTES_PAGES_PER_BATCH
    );

    const results = [];

    for (let index = 0; index < batches.length; index++) {
        const batch = batches[index];

        const firstPage = batch[0].pageNumber;
        const lastPage = batch[batch.length - 1].pageNumber;

        const source = batch
            .map(page => `SOURCE PAGE ${page.pageNumber}\n${page.text}`)
            .join("\n\n")
            .slice(0, 8500);

        setStatus(
            `Generating study notes: batch ${index + 1} of ${batches.length} · pages ${firstPage}–${lastPage}`
        );

        console.log("StudyFlow notes batch:", {
            batch: index + 1,
            totalBatches: batches.length,
            firstPage,
            lastPage,
            sourceCharacters: source.length
        });

        const prompt = `${tools.notes.prompt}

IMPORTANT:
Create notes only from the source pages below.
Do not introduce unrelated topics from general knowledge.
Do not invent definitions, formulas, examples, statistics or citations.
Do not add generic introductions, conclusions or study advice.
Preserve the source terminology.
Explain the concepts clearly enough for university revision.
Include examples and formulas when they appear in or are supported by the source.
Do not create MCQs or flashcards.

SOURCE TEXT:
${source}

Write the study notes for these pages now.`;

        const result = await generateWithOllama(prompt, {
            temperature: 0,
            numPredict: 1400
        });

        let notes = result.text;

        if (result.doneReason === "length") {
            setStatus(
                `Finishing notes for pages ${firstPage}–${lastPage}...`
            );

            const continuation = await generateWithOllama(
                `Continue these notes from where they stop.
Do not repeat the earlier notes.
Use only the source pages.
Do not introduce unrelated information.
Return only the continuation.

EXISTING NOTES:
${notes}

SOURCE PAGES:
${source}`,
                {
                    temperature: 0,
                    numPredict: 700
                }
            );

            notes += "\n\n" + continuation.text;
        }

        results.push(
            `## Pages ${firstPage}–${lastPage}\n\n${notes}`
        );
    }

    return results.join("\n\n");
}

// ============================================
// SUMMARY
// ============================================

function buildSummaryPrompt() {
    return `${tools.summarise.prompt}

PDF TEXT:
${extractedText.slice(0, 24000)}

Create the summary now.`;
}

// ============================================
// ASK YOUR PDF
// ============================================

function buildAskPrompt() {
    const question = questionInput
        ? questionInput.value.trim()
        : "";

    if (!question) {
        throw new Error("Please type a question about your PDF first.");
    }

    return `Answer directly using only the supplied PDF.
Do not guess.
If the answer is not present in the supplied text, say so.
Keep the answer clear and specific.

PDF TEXT:
${extractedText.slice(0, 24000)}

QUESTION:
${question}

ANSWER:`;
}

// ============================================
// RESULT RENDERER
// Preserves colourful cards from style.css
// ============================================

function renderPlainText(text, toolName) {
    if (!resultContent) return;

    resultContent.replaceChildren();

    addElement(
        resultContent,
        "h2",
        tools[toolName].title
    );

    const cleaned = text
        .replace(/^```(?:markdown|text)?\s*/i, "")
        .replace(/\s*```$/, "")
        .trim();

    const lines = cleaned.split(/\r?\n/);

    let section = null;
    let list = null;
    let paragraph = [];

    function flushParagraph() {
        if (!paragraph.length) return;

        const value = paragraph.join(" ").trim();

        if (value) {
            addElement(
                section || resultContent,
                "p",
                value
            );
        }

        paragraph = [];
    }

    function createSection(heading) {
        flushParagraph();

        section = document.createElement("section");
        section.className = "study-result-card";

        const cleanHeading = heading
            .replace(/^#{1,6}\s*/, "")
            .replace(/\*\*/g, "")
            .replace(/:$/, "")
            .trim();

        addElement(section, "h3", cleanHeading);

        resultContent.appendChild(section);

        list = null;
    }

    for (const rawLine of lines) {
        const line = rawLine.trim();

        if (!line) {
            flushParagraph();
            list = null;
            continue;
        }

        const heading = line
            .replace(/^#{1,6}\s*/, "")
            .replace(/\*\*/g, "")
            .replace(/:$/, "")
            .trim();

        const isHeading =
            line.length < 120 &&
            (
                /^#{1,6}\s+/.test(line) ||
                /^\*\*.+\*\*:?$/.test(line) ||
                /^(SUMMARY|OVERVIEW|KEY CONCEPTS|IMPORTANT DEFINITIONS|DEFINITIONS|KEY POINTS|REVISION CHECKLIST|CONCLUSION|STUDY NOTES|EXAMPLES)$/i.test(heading)
            );

        if (isHeading) {
            createSection(heading);
            continue;
        }

        const bullet = line.match(
            /^(?:[-*•]|\d+[.)])\s+(.+)$/
        );

        if (bullet) {
            flushParagraph();

            const target = section || resultContent;

            if (!list || list.parentElement !== target) {
                list = document.createElement("ul");
                target.appendChild(list);
            }

            addElement(
                list,
                "li",
                bullet[1].replace(/\*\*/g, "")
            );

            continue;
        }

        paragraph.push(line.replace(/\*\*/g, ""));
    }

    flushParagraph();

    // If the AI gives no headings, still show its response.
    if (resultContent.childElementCount <= 1 && cleaned) {
        addElement(resultContent, "p", cleaned);
    }

    latestResult = cleaned;

    if (resultBox) {
        resultBox.classList.remove("hidden");
    }

    if (downloadButton) {
        downloadButton.disabled = false;
    }

    if (resultType) {
        resultType.textContent = tools[toolName].title;
    }
}

// ============================================
// GENERATE CONTENT
// ============================================

async function runGeneration(toolName = activeTool) {
    if (isGenerating || isExtracting) return;

    if (!selectedFile || !extractedText.trim()) {
        setStatus(
            "Upload a PDF and wait until it says PDF ready.",
            true
        );
        return;
    }

    isGenerating = true;

    if (generateButton) {
        generateButton.disabled = true;
    }

    clearResult();

    try {
        let output;

        if (toolName === "notes") {
            output = await generateNotesBatched();

        } else if (toolName === "ask") {
            setStatus("Finding an answer in your PDF...");

            const result = await generateWithOllama(
                buildAskPrompt(),
                {
                    temperature: 0,
                    numPredict: 900
                }
            );

            output = result.text;

        } else {
            setStatus("Generating your PDF summary...");

            const result = await generateWithOllama(
                buildSummaryPrompt(),
                {
                    temperature: 0.1,
                    numPredict: 1400
                }
            );

            output = result.text;
        }

        renderPlainText(output, toolName);

        setStatus("Done! Your study material is ready.");

    } catch (error) {
        console.error("StudyFlow generation error:", error);

        setStatus(
            error.message || "Something went wrong while generating your result.",
            true
        );

    } finally {
        isGenerating = false;

        if (generateButton) {
            generateButton.disabled = false;
        }
    }
}

// ============================================
// BUTTON EVENTS
// ============================================

if (generateButton) {
    generateButton.addEventListener("click", () => {
        runGeneration(activeTool);
    });
}

if (askForm) {
    askForm.addEventListener("submit", event => {
        event.preventDefault();
        runGeneration("ask");
    });
}

// ============================================
// DOWNLOAD RESULTS
// ============================================

if (downloadButton) {
    downloadButton.addEventListener("click", () => {
        if (!latestResult) return;

        const name = tools[activeTool].title
            .replace(/[^a-z0-9]+/gi, "-")
            .toLowerCase();

        const blob = new Blob(
            [
                `${tools[activeTool].title}\n\n${latestResult}`
            ],
            {
                type: "text/plain;charset=utf-8"
            }
        );

        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");

        link.href = url;
        link.download = `${name || "studyflow-result"}.txt`;

        document.body.appendChild(link);
        link.click();
        link.remove();

        setTimeout(() => {
            URL.revokeObjectURL(url);
        }, 1000);
    });
}

// ============================================
// INITIALISE
// ============================================

chooseTool("summarise");

console.log("StudyFlow JavaScript loaded successfully.");
