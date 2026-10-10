# Student companion: a persistent partner across a student's work

Research and product assessment, October 10, 2026. Canvas means the university learning platform. Proposed interface: iMessage first, with voice, camera sessions, and useful interactive pages. This is a product design and API assessment; UNC API access and the prototype have not been tested.

## The product thesis

A student manages a portfolio of obligations: coursework, research, clubs, applications, group projects, and ordinary life. The hard part is repeatedly translating scattered information into a realistic next action, carrying enough context into the work, and noticing whether that action actually resolved the problem.

The companion should keep track of that continuity. It knows the relevant source material, what the student intended to do, where they got stuck, what they tried, and what remains unfinished. It can act through appropriate connected tools and create a small workspace for the current task. Canvas supplies institutional course facts; it does not supply the entire model of the student.

Product claim to test: the companion helps a student move from intention to useful progress with less repeated planning and context reconstruction. It should be evaluated on completed work and retained understanding, not the number of reminders or generated artifacts.

## Existing products set a high baseline

Wavelength's team describes a previous Photon project combining Canvas, Google Calendar, Gmail, and Slack for personalized iMessage reminders. A public Poke integration already provides Canvas context through text. “Canvas plus iMessage” is therefore an implementation foundation rather than the main differentiator. These are creator descriptions, not independently verified performance evaluations. [Wavelength](https://devpost.com/software/wavelength-9bzr06), [Poke Canvas MCP](https://github.com/Shashwatpog/poke-canvas-mcp)

StudyFetch documents Canvas integration and course-material import. Instructure's IgniteAI Agent demo describes educator/admin workflows and explicitly distinguishes that agent from student study tools. We should avoid presenting course-grounded AI or LMS tool calling as new. [StudyFetch integration](https://sso.studyfetch.com/docs/docs/product-docs/6a067a051289ddc3f19038b2), [Instructure demo](https://www.instructure.com/resources/videos/canvas-nextigniteai-agent-demo-video)

The opportunity is continuity across planning, doing, learning, teamwork, and recovery, with concrete evidence of progress. The companion should feel useful even on a day when the student never requests tutoring.

## Six connected jobs, with substantial capabilities

### 1. Understand the week and negotiate a realistic plan

“I have 45 minutes before the club meeting. What is worth doing?”

The companion combines deadlines, task dependencies, available time, the student's estimates, and previous work sessions. It proposes a specific action with its materials already open. It explains the tradeoff: why outlining the report is more useful right now than starting a long problem set.

Capabilities: detect a changed deadline or assignment instruction; identify a blocked prerequisite; split work into meaningful chunks; prepare a work session; adapt the plan when a meeting runs late; preserve deliberately protected free time. Estimated effort stays editable and uncertain, rather than being presented as an API fact.

### 2. Work beside the student and preserve their place

“I'm back. Where were we?”

The companion retrieves the last unresolved point, the student's draft, and the intended next step. A photo can capture handwritten work; an explicit camera session can keep a shared work surface visible. It can say, for example, “You had compared two sources but hadn't connected them to your claim. Here is your outline and the rubric criterion.”

Capabilities: maintain a session checkpoint; organize relevant sources; create a small calculator or diagram; turn notes into a next-action list; preserve abandoned questions; draft an office-hours agenda; resume on another device. It should not infer attention, motivation, or emotional state from a face.

### 3. Teach in the form that resolves the current obstacle

“I know the definition, but I don't understand what changes.”

The companion asks a short diagnostic question, then selects a representation: an explanation, worked parallel example, manipulable plot, spatial scene, oral practice, or retrieval exercise. The student predicts, acts, and explains the result. The companion checks an unfamiliar follow-up before marking the concept as understood.

Examples: rotate a plane through a 3D surface for multivariable calculus; compare molecular shapes; manipulate a circuit model; arrange evidence and claims for an essay; run an actual FlyBrain intervention for a research project. Use validated templates and numerical models for correctness-critical behavior. Generate the lesson and parameters around those components, with references to the actual course sources.

A 194-student undergraduate physics RCT supports the promise of deliberately designed AI tutoring for specific material. Another RCT in high-school mathematics found that unrestricted AI assistance could harm later unassisted performance. These results motivate hints, diagnosis, and independent transfer checks; they are not evidence that our app will improve grades. [Physics RCT](https://www.nature.com/articles/s41598-025-97652-6), [Mathematics RCT](https://pmc.ncbi.nlm.nih.gov/articles/PMC12232635/)

### 4. Coordinate shared work and reach human help

“We have a lab report due, and nobody is sure who owns the figures.”

In an opted-in group conversation, the companion tracks agreed responsibilities, dependencies, and open questions. It can prepare a handoff containing the actual work and context. It can help a student prepare for a TA or professor by assembling what they tried and the precise question still unanswered.

Capabilities: shared work sessions, meeting preparation, action-item follow-up, a group project state, peer explanations, office-hours preparation, and drafts of messages requesting clarification. Private grades and personal difficulties remain in the student's private conversation. Access to one student's Canvas does not grant access to their classmates' data.

### 5. Handle the surrounding student workload

“Help me prepare for tomorrow, including the things outside class.”

With separately connected sources, the companion can prepare a daily brief covering research deliverables, club responsibilities, applications, meetings, and materials to bring. A photographed event flyer could become a proposed calendar entry. It can help turn completed work into a portfolio record or identify an application requirement that remains unfinished.

Capabilities: calendar changes after authorization, application checklists, campus resource lookup, preparation packs, document organization, travel buffers, draft communications, and follow-up on promises the student explicitly made. Registration, financial aid, degree audit, and campus jobs usually require other university systems or public sources; Canvas should not be portrayed as exposing them.

### 6. Recover and improve over time

“The week fell apart. Help me recover.”

The companion distinguishes fixed deadlines from flexible plans, verifies current course information, and proposes a smaller sequence of actions. It can prepare a clarification or extension request for the student to review. After graded work returns, it translates feedback into a practice action and checks whether the same difficulty recurs.

Memory should be specific and correctable: “On two practice questions you confused the sign convention,” rather than a permanent claim about ability. Useful personalization includes preferred explanation style, realistic work durations, recurring blockers, and which interventions helped.

## What Canvas can actually expose

All access is bounded by the connected user's role, course visibility, and institutional configuration.

| API area | Useful available context | Product use |
|---|---|---|
| Courses | Active enrollments, course metadata, syllabus body when included | Course map and source-linked policies |
| Assignments | Description, points, submission type, user-effective due/lock dates, rubric when available | Explain requirements and detect changes |
| Modules and items | Course sequence, links to pages/files/assignments, progression requirements | Retrieve the material that leads into a task |
| Pages and files | Accessible page HTML and downloadable course files | Ground explanations and work sessions |
| Planner | Upcoming items and planner state | Daily/weekly overview |
| Submissions | Own submission state, timestamps, released grades/comments/rubric assessment as available | Verify submission and act on feedback |
| Announcements and course calendar | Posted updates and scheduled course events | Surface meaningful changes |

Official references: [Courses](https://developerdocs.instructure.com/services/canvas/resources/courses), [Assignments](https://developerdocs.instructure.com/services/canvas/resources/assignments), [Modules](https://developerdocs.instructure.com/services/canvas/resources/modules), [Pages](https://developerdocs.instructure.com/services/canvas/resources/pages), [Files](https://developerdocs.instructure.com/services/canvas/resources/files), [Planner](https://developerdocs.instructure.com/services/canvas/resources/planner), [Submissions](https://developerdocs.instructure.com/services/canvas/resources/submissions), [Announcements](https://developerdocs.instructure.com/services/canvas/resources/announcements).

An initial read-only integration can use `/api/v1/courses`, course assignments/modules/pages/files, `/api/v1/planner/items`, and the student's own submission endpoint. Follow pagination. Preserve source URLs and retrieval timestamps. Read the student-effective due date, including overrides. Recheck before time-sensitive recommendations. A planner checkmark does not prove a submission; a downloaded assignment does not prove completion.

External tools such as publisher homework platforms can appear as links or assignments without exposing their internal questions, attempts, or full feedback. A PDF can contain information absent from structured fields. Missing data should remain missing, with a request for the relevant material where needed.

Personal experimentation may use an authorized user token if the institution permits it. A multi-user application needs an appropriate OAuth integration and institution-issued developer credentials. Canvas lets administrators restrict student token generation. I did not verify UNC's current setting. If unavailable during HackNC, use a clearly labeled sample course or material the student explicitly supplies; do not claim a live integration. [OAuth documentation](https://developerdocs.instructure.com/services/canvas/oauth2/file.oauth), [Instructure token management update](https://community.instructure.com/en/discussion/660299/strengthening-security-in-canvas-updates-to-user-access-token-management)

## A distinctive demonstration: one continuous student work session

The following is a proposed demo scenario, not a claim about a current UNC assignment.

1. The student texts: “I have half an hour. Help me make progress.” The agent retrieves an assignment and a relevant course source, then proposes a concrete first step.
2. The student sends a photo of an attempted diagram and says what is confusing. The agent identifies a likely issue, shows the evidence, and asks one diagnostic question.
3. It sends an interactive link tailored to that issue. A spatially meaningful concept can appear above the worksheet through the iPhone camera. The student changes a parameter and predicts the outcome.
4. The agent asks a new question to test transfer. It saves what improved and what remains unresolved.
5. The student says the session must end early. The companion saves a resumable checkpoint and revises the next work block. A calendar write is distinct from a proposed schedule.
6. The next text can resume the same context. In a later stage, released instructor feedback updates the next practice session.

This demonstrates course awareness, planning, multimodal understanding, adaptive help, memory, and follow-through in one coherent interaction. Other capabilities can be genuine future product modules without pretending they are all implemented.

## Implementation shape

Use Photon for conversation and media intake. A backend routes requests to read-only Canvas tools, a task/memory store, document retrieval, session creation, and narrowly defined actions. The phone page provides the visual interaction. A websocket or equivalent updates an open experience when an authorized chat action changes its state.

Keep three distinct kinds of information: source facts with timestamps, student statements/preferences, and assistant hypotheses. A grade alone is not a diagnosis; a learner's answer or explanation is better evidence of a misconception. A proposed plan is not a committed calendar entry.

Memory belongs to the user, with a way to inspect and correct it. Shared sessions have explicit participants. Tokens belong in backend secret storage, never in texts or scene links. Let the student choose proactive moments and frequency; batch low-urgency changes into a useful brief. The companion should take initiative when it has a concrete reason.

For the first visual capability, use one validated experience family rather than arbitrary generated executable code. Examples are a parameterized circuit, a 3D surface/plane viewer, or a FlyBrain comparison backed by identified runs. Other work should receive a useful document, plot, or checklist when that representation fits better.

## How to validate the actual value

Recruit three to five students and observe a real work session. Ask them to show where they last lost time: deciding what to do, locating material, understanding a concept, coordinating others, or resuming unfinished work. Prototype the biggest repeated obstacle first.

Measure time from “I should work” to the first useful action, whether they can resume later without restating context, whether suggestions reference the correct course facts, and whether a new problem is solved without assistance. Ask whether they would use it again tomorrow and which capability they would miss. That is stronger evidence than counting generated messages.

A small HackNC build can prove one whole session plus one interruption/recovery event. The long-term product can extend across the six jobs above. The differentiator is their continuity, supported by reliable source facts and useful actions.
