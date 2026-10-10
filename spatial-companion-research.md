# Spatial work companion: camera, AR, iMessage, and FlyBrain

Research and product assessment, October 10, 2026. Available hardware: iPhones and a laptop/webcam. This is a design proposal, not an implemented or user-validated product.

## The problem worth building around

People doing physical or scientific work often need help answering three questions: what is happening, what changed, and what should I test next? Their evidence is scattered between the work surface, diagrams, conversations, and software outputs. An assistant becomes useful when it can connect those pieces to an action whose result the person can inspect.

The product hypothesis: an iMessage collaborator that creates a persistent, shared experiment or work session, uses camera observations as evidence, and sends a spatial experience when pointing, comparing, or manipulating is useful. A link refers to a particular experiment and its history, rather than an unrelated generated scene.

This hypothesis has two promising starting markets. They should be evaluated separately: student research teams exploring causal models, and makers working on physical assemblies. The camera is essential in the second; the scientific model is essential in the first.

## What the research supports

HoloAssist studied human assistance during physical tasks using 166 hours of interactions from 350 instructor-performer pairs. Its benchmarks distinguish detecting a mistake, deciding when to intervene, and grounding the intervention. Our implication: recognizing objects is insufficient; the assistant needs a task state and a reason to speak. This dataset does not establish that a general AI can reliably perform those jobs. [HoloAssist paper](https://arxiv.org/abs/2309.17024)

Spatial Gaze Markers tested AR reminders with 20 participants. In a simulated repair task with distraction, mean relocalization time was 3.39 seconds with markers versus 7.13 seconds without them; the inspection task did not show a significant benefit. This is evidence for a specific spatial-memory benefit, not for universal AR productivity improvements. [Author-hosted CHI paper](https://www.hci.otago.ac.nz/papers/Lystb%C3%A6kACMCHI2024.pdf)

An AR breadboard visualization deployment found enthusiasm but poor voluntary uptake: only two of 14 students used it after the introduction. Portability and disruption mattered. The design lesson is to make the visual help quick to enter and tied to a moment of need. [Holoboard study](https://repository.isls.org/bitstream/1/6456/1/1813-1814.pdf)

A neuroanatomy experiment with 31 students found larger test improvement with cross-sections than its AR condition, driven mainly by cross-sectional questions. The implication is to match the activity to the learning objective and measure transfer. A beautiful brain is not evidence of learning. [GreyMapp study](https://pmc.ncbi.nlm.nih.gov/articles/PMC7317366/)

RealitySketch demonstrates responsive graphics bound to physical motion. Augmented Physics demonstrates transforming textbook diagrams into interactive simulations, with authoring and usability evaluations. These support technical and interaction precedents; neither proves our companion will improve academic outcomes. [RealitySketch](https://arxiv.org/abs/2008.08688), [Augmented Physics](https://arxiv.org/abs/2405.18614)

## Candidate A: a shared causal lab, with FlyBrain as its first experiment

**First user:** a student joining a computational neuroscience project who can run a notebook but struggles to connect neuron identities, model interventions, plots, and the team's hypotheses.

**Job:** turn a question about a circuit into a reproducible comparison that the whole group can understand and revisit.

Proposed experience:

1. A teammate texts the agent: “Show us what changes when we silence this sensory neuron.” The request can reference a previous run or an annotated diagram.
2. The agent resolves the neuron and displays the proposed intervention and baseline. Ambiguous labels require a selection, not a guessed scientific identity.
3. It starts the simulation and sends a session link. An iPhone points at a printed experiment sheet to place the visualization on the table.
4. A translucent fly and an enlarged circuit appear. Baseline and intervention sit side by side; neural activity and output plots come from the same identified simulation runs.
5. Another teammate texts a competing hypothesis or requests a second intervention. The session branches, preserving the earlier result.
6. The agent posts an experiment receipt: question, parameters, seed, dataset/model version, output, interpretation, and next test.

The useful outcome is that a team can agree on what it tested and whether the evidence supports its claim. The memorable visual moment is the exact intervention changing the activity pattern in a shared spatial scene.

### What FlyBrain can actually supply

The Shiu et al. model studies sensorimotor transformations, including gustatory input and feeding-related motor output, with a connectome-based leaky integrate-and-fire model. It offers a real basis for comparing activation and silencing interventions. Its assumptions omit important biology, so output is a model prediction. Use model-derived activity to drive the visualization; any fly-body animation is an explanatory mapping unless independently validated. [Published paper](https://pmc.ncbi.nlm.nih.gov/articles/PMC11446845/)

I read the current local run manifest and silencing summary at:

- [manifest.json](/Users/youssefkusibati/Documents/Random_Projects/flybrain/shiu-baseline/results/explore/20261010T125911025339Z/manifest.json)
- [silencing_summary.csv](/Users/youssefkusibati/Documents/Random_Projects/flybrain/shiu-baseline/results/explore/20261010T125911025339Z/silencing_summary.csv)

The manifest records one-second simulations taking approximately 4.9–26.3 seconds, with one trial per condition. Its 100 Hz comparison gives MN9 output of 71 Hz for baseline, and 71, 62, and 73 Hz for three individual silencing conditions. These are exploratory saved results, not a replicated effect or a fresh benchmark. They suggest an asynchronous text-and-result workflow is practical. Use multiple seeds before making a scientific claim.

The camera could recognize the experiment sheet, capture a whiteboard hypothesis, or locate a deliberately designed physical control. It cannot infer sugar concentration from a cup or recover a neural intervention from an arbitrary room image. A paper diagram is a reference input; camera recognition and circuit identity must be checked separately.

### Existing alternatives and the actual distinction

FlyBrainLab already combines 3D exploration and executable circuits. NeuroNLP already accepts natural-language-style queries and shares query results. Therefore, “talk to a 3D fly brain” is not a sufficient novelty claim. The proposed distinction is a group conversation that preserves experiment provenance, asynchronous runs, and a shared spatial comparison. [FlyBrainLab](https://flybrainlab.github.io/FlyBrainLabWeb/), [NeuroNLP.FlyWire](https://flywire.neuronlp.fruitflybrain.org/)

### Two-minute demo

- 0–20 seconds: a judge texts a hypothesis and receives a live session link.
- 20–45 seconds: the phone opens the baseline circuit above a printed diagram. Everyone sees the same selected experiment on a laptop display too.
- 45–85 seconds: the judge chooses an intervention. The model runs while the agent asks for a prediction and shows what is being held constant.
- 85–110 seconds: the actual comparison appears, with a visible output difference or an honest null result.
- 110–120 seconds: the group receives the reproducible experiment receipt and can open the same comparison on another phone.

Prepared results may provide a labeled replay if a computation fails. They should never be presented as the result of an unexecuted live intervention.

## Candidate B: a workbench that remembers and helps explain changes

**First user:** a student maker sharing a project bench with teammates, leaving midway through an assembly, or returning to a device that stopped working.

**Job:** recover the last known working state and decide which visible change to inspect next.

Example: “The mechanism worked before lunch. What changed?” A webcam compares explicitly saved checkpoints. The agent sends a link that overlays the previous arrangement on the current work surface, highlights a moved part, and retrieves the team's note about why it was moved. The user can scrub a short history and ask a remote teammate to mark the part they mean.

The spectacle is a ghost of the earlier assembly aligned with the present one. The value is less reconstruction of context, clearer handoffs, and faster testing of plausible causes.

This should start with a known assembly and a marked work mat. A camera can support visible position and assembly-state comparisons. Electrical continuity, internal damage, voltage, and mechanical load require measurements or explicit reports. An image difference identifies a change; it does not prove that change caused the failure.

Augmented Silkscreen specifically investigated the burden of moving between PCB reference information and physical boards. It supports the problem choice, while also showing that AR-assisted debugging has substantial prior art. Our proposed distinction would be the persistent history and conversational team handoff. [Author-hosted paper](https://ubicomplab.cs.washington.edu/pdfs/augmented_silkscreen.pdf)

For this candidate, FlyBrain is optional. It could be the team's actual research project, but using a biological circuit as a generic room-understanding system would add an unvalidated dependency.

## Candidate C: insect-inspired room navigation

There is legitimate research on mushroom-body-inspired visual route memory, including embodied robot navigation. NeuroMechFly also supports embodied sensorimotor research. These are appealing future directions for a virtual guide that learns routes or helps compare robot controllers. They use distinct models, sensing assumptions, and training/evaluation work; the current feeding simulation cannot be relabeled as a room-navigation system. [Mushroom-body route memory](https://journals.plos.org/ploscompbiol/article?id=10.1371/journal.pcbi.1004683), [NeuroMechFly v2](https://www.nature.com/articles/s41592-024-02497-y)

For HackNC, this is the highest scientific and integration risk of the three. A virtual fly that follows a scripted path could be a mascot, but should be described as one.

## Implementation on the available hardware

Photon is the conversational entrance and asynchronous notification channel. Its cloud provider supports messages, attachments, and existing groups. New group creation requires a dedicated line. The experiment page handles live interaction and visual updates; switching apps should not lose the session. [Photon iMessage docs](https://photon.codes/docs/spectrum-ts/providers/imessage)

A practical first implementation uses a laptop backend, one fixed webcam, and a browser experience opened from iMessage. Camera frames become timestamped observations associated with a known work surface. The backend owns the experiment state. Both the webcam and phone align to a shared printed target or a calibrated work mat; object detection alone does not provide a common 3D coordinate system.

MindAR supports image tracking and Three.js integration, making it a candidate for an interactive view anchored to a printed image. Actual iPhone compatibility, camera permission, alignment stability, and performance still need a device test. [MindAR documentation](https://hiukim.github.io/mind-ar-js-doc/)

Apple Quick Look can display USDZ assets in AR from Safari and Messages, including prepared animations. It is useful for a shareable 3D snapshot; its documented asset-viewing capabilities do not establish a live synchronized application backend. [Apple Quick Look](https://developer.apple.com/quick-look-gallery/)

Use a bounded, explicitly started camera session and retain selected evidence/checkpoints. A background iPhone web page is not a dependable always-on room observer. The laptop can remain the session camera while users text and open links.

## Tests that would justify pursuing it

For the causal lab, ask three to five student researchers to reproduce a comparison and explain what changed. Compare time to a correct explanation and reproducibility against a notebook plus screen sharing. Test whether AR adds value beyond the same interactive scene in ordinary 3D.

For the workbench, interrupt a small assembly, alter one visible element, and ask users to resume or hand off. Compare against ordinary checkpoint photographs and chat messages. Measure wrong-part selections, recovery time, and time spent operating the assistant.

For both, test a second phone, stale observations, ambiguous requests, camera occlusion, and dropped session connections. The critical product question is whether the visual experience helps someone make a better next move.

## HackNC position

Photon is central because a group can request, follow, and revisit work through actual conversation. Gemini is a natural additional integration for interpreting images and selecting tools. Voice becomes useful if it helps a person whose hands are occupied. Frutiger Aero styling suits the spatial scenes, but a nature-focused track claim needs a substantive nature or sustainability connection beyond appearance. Use the current organizer rules when finalizing entries.

If incorporating existing FlyBrain work, distinguish the published model and pre-existing research from the interface and interaction built during hacking. Resolve eligibility against the event's no-prebuilt-project rule before choosing that submission base.
