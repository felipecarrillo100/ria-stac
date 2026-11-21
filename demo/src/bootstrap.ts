// The LuciadRIA license must be set before any RIA module that needs it is evaluated, so the app loads after it.
// The license file is not in the repository: copy your development license to demo/public/license.txt.
import {setLicenseText} from "@luciad/ria/util/License.js";

const response = await fetch("./license.txt");
const text = response.ok ? await response.text() : "";
if (!text || text.trimStart().startsWith("<")) {
    document.getElementById("root")!.innerHTML = '<p style="font: 16px Inter, sans-serif; padding: 24px">No LuciadRIA license: '
        + "copy your development license to <code>demo/public/license.txt</code> and reload.</p>";
} else {
    setLicenseText(text);
    await import("./main.js");
}
