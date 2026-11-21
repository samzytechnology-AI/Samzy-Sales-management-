/**
 * Samzy's source-of-truth service catalogue for prospect discovery and qualification.
 * "active" means an intended core offer; it does not certify capacity for every scope.
 * "requires_confirmation" services must never be pitched as currently available by default.
 */

export type ServiceReadiness = "active" | "requires_confirmation";

export interface SamzyService {
  id: string;
  category: string;
  name: string;
  readiness: ServiceReadiness;
  outcomes: string[];
  deliverables: string[];
  idealCustomers: string[];
  painSignals: string[];
  evidenceToVerify: string[];
  qualificationQuestions: string[];
  exclusions: string[];
  searchTerms: string[];
  pricingFloorNgn?: number;
}

export const SAMZY_SERVICE_CATALOG: readonly SamzyService[] = [
  {
    id: "business-websites",
    category: "Website Development",
    name: "Business and corporate website development",
    readiness: "active",
    outcomes: ["stronger online credibility", "clearer service discovery", "more qualified enquiries"],
    deliverables: ["corporate/business websites", "landing pages", "portfolio websites", "school, real-estate, hotel and service-business websites", "responsive pages", "contact and enquiry flows", "domain and hosting setup where agreed", "website redesign and maintenance"],
    idealCustomers: ["SMEs", "professional service firms", "schools", "real-estate firms", "hotels", "restaurants", "growing local businesses"],
    painSignals: ["active business with no official website", "website is broken or visibly outdated", "mobile experience is difficult to use", "no clear service information or enquiry path", "business relies entirely on social profiles for discovery"],
    evidenceToVerify: ["official website search results", "live homepage and mobile usability", "service/contact pages", "business activity and official contact channel"],
    qualificationQuestions: ["What should the website help customers do?", "Which pages and functions are required?", "Who will provide the content and approve the design?", "Is a domain or existing website already owned?"],
    exclusions: ["Do not claim a website is absent until checked across reliable sources.", "Do not promise rankings, traffic or sales guarantees.", "Do not include paid hosting, domains or third-party licences without explicit scope."],
    searchTerms: ["business website", "corporate website", "website redesign", "landing page", "school website", "hotel website", "real estate website"],
    pricingFloorNgn: 100000,
  },
  {
    id: "ecommerce",
    category: "Website Development",
    name: "E-commerce website development",
    readiness: "active",
    outcomes: ["online product discovery", "structured product enquiries or orders", "simpler catalogue management"],
    deliverables: ["online storefront", "product/category pages", "cart and checkout scope", "order management", "payment integration when supported and agreed", "basic store administration"],
    idealCustomers: ["retailers", "electronics shops", "fashion and beauty stores", "wholesalers", "product brands"],
    painSignals: ["large product catalogue only displayed through social posts", "manual order-taking creates visible friction", "customers cannot browse stock or product details online", "business advertises online sales but lacks a usable checkout"],
    evidenceToVerify: ["product catalogue and sales channels", "current ordering process", "delivery geography", "payment and fulfilment options"],
    qualificationQuestions: ["How many products and variants are involved?", "Do you need online payment or order requests first?", "How are inventory, delivery and returns handled?", "Which payment provider and currency are required?"],
    exclusions: ["Do not assume inventory/ERP integration is included.", "Do not promise payment-provider approval or financial compliance.", "Do not quote before product count, checkout and fulfilment scope are known."],
    searchTerms: ["ecommerce website", "online store", "shop online", "product catalogue", "online ordering"],
    pricingFloorNgn: 150000,
  },
  {
    id: "web-applications",
    category: "Mobile and Web App Development",
    name: "Custom web applications and business dashboards",
    readiness: "active",
    outcomes: ["less manual administration", "centralised operational records", "role-based workflows"],
    deliverables: ["custom web apps", "admin dashboards", "CRM-style systems", "inventory and booking workflows", "internal business tools"],
    idealCustomers: ["SMEs with repeatable manual processes", "service operators", "education providers", "operations teams"],
    painSignals: ["staff duplicate records across spreadsheets", "manual tracking causes delays or errors", "business has repeatable workflows without a central system", "management lacks a reliable operational view"],
    evidenceToVerify: ["publicly described workflow or service process", "job posts indicating operational complexity", "customer-facing process", "prospect-confirmed pain before solution claims"],
    qualificationQuestions: ["Which process is currently manual?", "Who uses the system and what roles are needed?", "What records and reports are essential?", "Are there existing tools or data to migrate?"],
    exclusions: ["Do not infer internal pain from company size alone.", "Do not promise integrations until APIs and permissions are confirmed.", "Do not collect sensitive production data during early qualification."],
    searchTerms: ["custom business software", "web application", "admin dashboard", "workflow software", "business management system"],
  },
  {
    id: "android-apps",
    category: "Mobile and Web App Development",
    name: "Android and mobile application development",
    readiness: "active",
    outcomes: ["mobile access to a defined service", "improved customer or staff workflow"],
    deliverables: ["Android applications", "mobile business tools", "customer/staff apps", "API-connected mobile experiences where supported"],
    idealCustomers: ["businesses with repeat mobile user journeys", "service providers", "organisations with field teams"],
    painSignals: ["a core service requires repeated mobile interactions", "customers or staff need mobile access to a verified workflow", "existing mobile app is broken or unsupported"],
    evidenceToVerify: ["current mobile service journey", "target users and devices", "existing app/store listing if any", "backend/API readiness"],
    qualificationQuestions: ["Why is a mobile app necessary instead of a responsive website?", "Who will use it?", "Which devices and features are essential?", "What backend or integrations already exist?"],
    exclusions: ["Do not recommend an app where a simpler website is sufficient.", "Do not promise App Store/Play Store approval.", "Do not assume backend/API access."],
    searchTerms: ["Android app development", "mobile application", "business mobile app"],
  },
  {
    id: "school-management",
    category: "Mobile and Web App Development",
    name: "School Management System",
    readiness: "active",
    outcomes: ["centralised school administration", "more organised academic records", "parent/student access to approved information"],
    deliverables: ["student records", "class and subject management", "results/reporting workflows", "attendance and timetable modules", "teacher/admin portals", "fee records when scoped"],
    idealCustomers: ["private schools", "school groups", "education providers"],
    painSignals: ["school still coordinates records through paper or disconnected spreadsheets", "results processing is visibly manual", "school advertises digital services but has no coherent portal"],
    evidenceToVerify: ["school identity and current operations", "existing school portal or software", "number of campuses/students/classes", "decision-maker and procurement route"],
    qualificationQuestions: ["Which school processes need digitising first?", "How many students, staff and campuses?", "Which roles and access permissions are required?", "Is there an existing database to migrate?"],
    exclusions: ["Do not assume all modules are required.", "Do not promise migration or integrations before data review.", "Treat student data as sensitive and scope security/access controls."],
    searchTerms: ["school management system", "school portal", "student information system", "school software"],
    pricingFloorNgn: 350000,
  },
  {
    id: "hospital-management",
    category: "Mobile and Web App Development",
    name: "Hospital and clinic management software",
    readiness: "active",
    outcomes: ["structured administrative workflows", "better coordination of operational records"],
    deliverables: ["patient registration workflows", "reception/admin portals", "staff workflows", "department configuration", "reports and records within agreed scope"],
    idealCustomers: ["private hospitals", "clinics", "diagnostic centres"],
    painSignals: ["facility describes fragmented administrative workflows", "patient-facing process relies on paper or repeated manual entry", "facility is actively seeking digital operations tools"],
    evidenceToVerify: ["facility type and size", "existing hospital information system", "workflow owners", "data protection and hosting requirements"],
    qualificationQuestions: ["Which departments and workflows are in scope?", "What user roles and access boundaries are required?", "What patient data is processed?", "What existing systems must remain integrated?"],
    exclusions: ["Do not claim clinical decision support or medical-device capability.", "Do not promise regulatory compliance without specialist review.", "Do not access real patient records during prospect research."],
    searchTerms: ["hospital management system", "clinic management software", "hospital information system"],
  },
  {
    id: "graphic-design",
    category: "Graphic Design and Branding",
    name: "Graphic design and brand identity",
    readiness: "active",
    outcomes: ["consistent brand presentation", "clearer promotional communication"],
    deliverables: ["logo design", "brand identity assets", "flyers", "social media graphics", "business cards", "brochures", "company profiles", "banners", "product adverts"],
    idealCustomers: ["SMEs", "new businesses", "events companies", "retailers", "schools", "professional services"],
    painSignals: ["inconsistent visual identity across official channels", "active promotions use visibly poor or inconsistent design", "new business lacks basic brand materials"],
    evidenceToVerify: ["official social pages and website", "recent promotional materials", "brand consistency across channels"],
    qualificationQuestions: ["Which exact assets are needed?", "Are brand guidelines or editable source files available?", "What sizes, platforms and deadlines apply?", "Who approves the design?"],
    exclusions: ["Do not insult or disparage the prospect's existing design.", "Do not promise trademark availability for a logo.", "Do not assume unlimited revisions or source files."],
    searchTerms: ["graphic design", "logo design", "brand identity", "business flyer", "social media design"],
  },
  {
    id: "ai-automation",
    category: "AI Solutions and Business Automation",
    name: "AI assistants and business process automation",
    readiness: "active",
    outcomes: ["reduced repetitive work", "faster information handling", "more consistent customer workflows"],
    deliverables: ["AI assistants", "customer-support chatbots", "lead-handling workflows", "email/WhatsApp automation where approved", "document processing", "AI reporting", "supported API integrations"],
    idealCustomers: ["businesses with repeated customer enquiries", "service teams", "sales teams", "operations teams"],
    painSignals: ["same enquiries answered repeatedly", "leads are manually copied between channels", "staff repeatedly process similar documents", "slow response process is explicitly evidenced"],
    evidenceToVerify: ["publicly visible enquiry channels", "prospect-confirmed repetitive process", "volume and frequency", "available system/API access and data permissions"],
    qualificationQuestions: ["Which repetitive task should be automated?", "How often does it occur and who handles it?", "Which systems/channels are involved?", "What must always be reviewed by a human?"],
    exclusions: ["Do not promise fully autonomous decisions for sensitive workflows.", "Do not send messages or process personal data without consent and safeguards.", "Do not promise integrations before API access is verified."],
    searchTerms: ["AI automation", "business process automation", "customer support chatbot", "lead automation", "workflow automation"],
  },
  {
    id: "cybersecurity",
    category: "Cybersecurity and Technology Solutions",
    name: "Cybersecurity assessment and technology consulting",
    readiness: "active",
    outcomes: ["better understanding of security exposure", "stronger basic security configuration"],
    deliverables: ["authorised website security review", "basic vulnerability assessment", "security configuration review", "access-control recommendations", "backup/recovery planning", "security awareness and troubleshooting"],
    idealCustomers: ["SMEs with public websites", "organisations handling business records", "businesses requesting an authorised security review"],
    painSignals: ["publicly disclosed security incident", "visible insecure configuration that can be responsibly verified", "prospect explicitly requests a security review", "no clear backup or access-control practice confirmed by prospect"],
    evidenceToVerify: ["publicly disclosed issue or prospect statement", "written authorisation and scope", "systems owner", "permitted testing boundaries"],
    qualificationQuestions: ["Which assets do you own or have authority to test?", "What assessment scope and exclusions are approved?", "Is there a maintenance window and incident contact?", "What evidence/report format is required?"],
    exclusions: ["Never probe, scan, exploit or access systems without explicit written authorisation.", "Do not claim a system is vulnerable from appearance alone.", "Do not promise certification, compliance or guaranteed security."],
    searchTerms: ["cybersecurity assessment", "website security review", "security consulting", "backup recovery planning"],
  },
  {
    id: "seo-optimisation",
    category: "Digital Growth (Expansion)",
    name: "SEO and website optimisation",
    readiness: "requires_confirmation",
    outcomes: ["improved technical discoverability and usability"],
    deliverables: ["technical SEO audit", "on-page optimisation", "performance recommendations"],
    idealCustomers: ["businesses with an existing website and search visibility goals"],
    painSignals: ["prospect confirms poor organic visibility", "technical performance issues verified with suitable tools"],
    evidenceToVerify: ["website ownership", "search visibility data", "performance test results"],
    qualificationQuestions: ["Which search outcomes matter?", "Do you have Search Console or analytics access?"],
    exclusions: ["Do not pitch as an active offer until capability and delivery process are confirmed.", "Never guarantee rankings."],
    searchTerms: ["SEO services", "website speed optimisation", "search visibility"],
  },
  {
    id: "digital-marketing",
    category: "Digital Growth (Expansion)",
    name: "Digital marketing and social media management",
    readiness: "requires_confirmation",
    outcomes: ["more consistent campaign execution and audience communication"],
    deliverables: ["campaign planning", "content calendars", "social account management", "paid campaign coordination"],
    idealCustomers: ["businesses actively seeking ongoing marketing support"],
    painSignals: ["prospect requests campaign management", "inconsistent publishing confirmed by the business"],
    evidenceToVerify: ["marketing objectives", "account ownership", "budget and approval process"],
    qualificationQuestions: ["Which channels and outcomes matter?", "Who supplies and approves content?", "What monthly budget and reporting are expected?"],
    exclusions: ["Do not pitch as active until capacity, ad-account access and scope are confirmed.", "Do not guarantee reach, leads or sales."],
    searchTerms: ["social media management", "digital marketing agency", "online advertising"],
  },
  {
    id: "it-support-cloud-data",
    category: "IT and Data Services (Expansion)",
    name: "IT support, cloud infrastructure and data analytics",
    readiness: "requires_confirmation",
    outcomes: ["more reliable technology operations and clearer reporting"],
    deliverables: ["IT support plans", "cloud setup", "database design/management", "data dashboards", "analytics/reporting"],
    idealCustomers: ["organisations with defined support, hosting or reporting requirements"],
    painSignals: ["prospect requests managed support", "cloud migration need confirmed", "reporting process is fragmented"],
    evidenceToVerify: ["current infrastructure", "service-level expectations", "data sources and access rights", "support coverage requirements"],
    qualificationQuestions: ["What systems are in scope?", "What availability and response times are expected?", "Which cloud/data platform is used?", "Who owns security and backups?"],
    exclusions: ["Do not pitch as active until staffing, tools, support coverage and delivery competence are confirmed.", "Do not promise uptime or incident response SLAs without an approved operating model."],
    searchTerms: ["IT support", "cloud infrastructure", "database management", "data analytics", "business intelligence"],
  },
  {
    id: "integrations-elearning",
    category: "Specialist Software (Expansion)",
    name: "Advanced API integrations, e-learning and CBT platforms",
    readiness: "requires_confirmation",
    outcomes: ["connected software workflows", "structured online learning and assessment"],
    deliverables: ["third-party API integrations", "e-learning portals", "CBT/examination platforms", "document/workflow management"],
    idealCustomers: ["education providers", "businesses with integration requirements", "organisations running structured assessments"],
    painSignals: ["prospect confirms disconnected systems", "education provider requests online examinations or learning"],
    evidenceToVerify: ["API documentation and access", "exam rules and question-bank requirements", "user volume and integrity controls"],
    qualificationQuestions: ["Which systems must connect?", "Is API access documented and authorised?", "What exam controls and reporting are required?", "What scale and availability are expected?"],
    exclusions: ["Do not pitch as active until technical feasibility, capacity and delivery proof are reviewed.", "Do not promise integrations without vendor/API support."],
    searchTerms: ["API integration", "e-learning platform", "CBT software", "online examination system", "document management system"],
  },
] as const;

export const ACTIVE_SAMZY_SERVICES = SAMZY_SERVICE_CATALOG.filter((service) => service.readiness === "active");
export const CONFIRMATION_REQUIRED_SERVICES = SAMZY_SERVICE_CATALOG.filter((service) => service.readiness === "requires_confirmation");

/** Compact, deterministic catalogue prompt so all three AI agents use the same service boundaries. */
export function renderSamzyServiceDiscoveryRules(): string {
  const active = ACTIVE_SAMZY_SERVICES.map((service) => [
    `- ${service.name} [${service.id}]`,
    `  Outcomes: ${service.outcomes.join("; ")}.`,
    `  Deliverables: ${service.deliverables.join("; ")}.`,
    `  Ideal customers: ${service.idealCustomers.join("; ")}.`,
    `  Observable pain signals: ${service.painSignals.join("; ")}.`,
    `  Verify: ${service.evidenceToVerify.join("; ")}.`,
    `  Qualify: ${service.qualificationQuestions.join("; ")}.`,
    `  Guardrails: ${service.exclusions.join(" ")}`,
    ...(service.pricingFloorNgn ? [`  Minimum asking floor: NGN ${service.pricingFloorNgn.toLocaleString("en-NG")} (not an automatic quote; confirm scope and obtain Samuel's approval).`] : []),
  ].join("\n")).join("\n");
  const expansion = CONFIRMATION_REQUIRED_SERVICES.map((service) =>
    `- ${service.name}: ${service.outcomes.join("; ")}. Search for demand and record it as an expansion opportunity only; do not pitch as currently available.`,
  ).join("\n");

  return [
    "SAMZY SERVICE-MATCHING CATALOGUE — MANDATORY SOURCE OF TRUTH",
    "Match each prospect to one primary active service and, only when justified, one secondary service. Do not recommend every service to every business.",
    "ACTIVE OFFERS (eligible for matching, subject to scope/capacity confirmation):",
    active,
    "EXPANSION OPPORTUNITIES (demand may be researched, but must be labelled requires_capability_confirmation and must not be sold as currently available):",
    expansion,
    "DISCOVERY METHOD:",
    "1. Establish the business identity, location, industry, what it sells, whether it is operating, and its official website/social/contact channels. Cite each material finding with its source URL or mark it unverified.",
    "2. Inspect its actual customer journey: discovery → understanding the offer → trust/proof → enquiry/order/booking → follow-up. Identify a specific friction only when evidence supports it.",
    "3. Match verified or clearly labelled inferred pain to the smallest relevant active service. A missing website, poor design, manual process or security weakness must never be assumed; verify it.",
    "4. Return a service-fit record for every candidate: matched_service_id, service_name, readiness, observed_need, evidence_urls, evidence_quotes_or_summary, confidence (low/medium/high), business_benefit, fit_reasons, unknowns, qualification_questions, likely_scope, pricing_floor_if_applicable, and next_best_action.",
    "5. Score out of 100 using service fit (25), evidence strength (25), reachable official contact/decision path (15), visible business activity (15), plausible ability to pay (10), and timing/trigger (10). If a dimension is unknown, score conservatively and disclose it; never manufacture points.",
    "6. Disqualify or defer duplicate businesses, inactive/unclear businesses, no credible service need, no legitimate contact route, existing adequate solution with no evidenced gap, prohibited/unsafe requests, or projects outside confirmed capability/capacity. Explain the reason.",
    "7. Prioritise prospects with a real, solvable need and plausible commercial value. Recommend a tailored 35–65 word first message only after research; one verified observation, one practical benefit, one low-friction question. Never send it automatically.",
    "8. Do not confuse an industry match with a buying signal. Schools may fit school software, retailers may fit ecommerce, but only specific evidence or discovery confirms actual need and buying intent.",
    "9. Never fabricate prospect names, contact details, budgets, defects, decision-makers, urgency, competitors, testimonials, case studies, or likely revenue. If evidence is insufficient, say so and recommend the next research step.",
    "10. Do not treat this catalogue as proof of current staff capacity, legal registration, certifications, platform partnerships or guaranteed delivery. Scope and delivery feasibility must still be confirmed by Samuel.",
  ].join("\n\n");
}
