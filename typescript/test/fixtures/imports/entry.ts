import { greet, projectInput } from "./helper";
import type { Greeting } from "./helper";

const g: Greeting = { project: projectInput(), count: 2 };
core.info(`entry saw ${greet(g)}`);
return greet(g);
