import {useEffect, useState} from "react";
import {Box, Button, Stack, TextField, ToggleButton, ToggleButtonGroup, Typography} from "@mui/material";
import PublicIcon from "@mui/icons-material/Public";
import CropFreeIcon from "@mui/icons-material/CropFree";
import HighlightAltIcon from "@mui/icons-material/HighlightAlt";
import type {Bbox} from "ria-stac";
import {explorer, useExplorer, type AreaMode} from "../state/explorer.js";
import {bboxSize} from "../util.js";

/** The world, the map view, or a bounding box drawn or typed: the same choice in Browse and Search. */
export function AreaChooser({value, onChange, worldNote}: { value: AreaMode; onChange: (m: AreaMode) => void; worldNote: string }) {
    const s = useExplorer();
    const [typed, setTyped] = useState<string[]>(s.bbox?.map(String) ?? ["", "", "", ""]);
    useEffect(() => { if (s.bbox) setTyped(s.bbox.map((v) => String(+v.toFixed(5)))); }, [s.bbox]);
    const numbers = typed.map(Number);
    const valid = typed.every((t) => t.trim() !== "") && numbers.every(Number.isFinite) && numbers[0] < numbers[2] && numbers[1] < numbers[3]
        && numbers[0] >= -180 && numbers[2] <= 180 && numbers[1] >= -90 && numbers[3] <= 90;
    return (
        <Stack spacing={1}>
            <ToggleButtonGroup exclusive fullWidth size="small" value={value} onChange={(_e, m: AreaMode | null) => m && onChange(m)} aria-label="Area">
                <ToggleButton value="world"><PublicIcon fontSize="small" sx={{mr: 0.5}}/>The world</ToggleButton>
                <ToggleButton value="view"><CropFreeIcon fontSize="small" sx={{mr: 0.5}}/>Map view</ToggleButton>
                <ToggleButton value="bbox"><HighlightAltIcon fontSize="small" sx={{mr: 0.5}}/>Bounding box</ToggleButton>
            </ToggleButtonGroup>
            {value === "world" && <Typography variant="caption" color="text.secondary">{worldNote}</Typography>}
            {value === "view" && <Typography variant="caption" color="text.secondary">
                {s.viewBbox ? `Follows the map: ${bboxSize(s.viewBbox)} now.` : "The view shows no ground: zoom in."}</Typography>}
            {value === "bbox" && (
                <Box>
                    <Box sx={{display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 0.75}}>
                        {["West", "South", "East", "North"].map((label, i) => (
                            <TextField key={label} label={label} value={typed[i]} inputMode="decimal"
                                onChange={(e) => setTyped(typed.map((t, j) => (j === i ? e.target.value : t)))}
                                slotProps={{htmlInput: {"aria-label": `${label} (degrees)`}}}/>
                        ))}
                    </Box>
                    <Stack direction="row" spacing={1} sx={{mt: 1, flexWrap: "wrap"}}>
                        <Button variant={s.drawing ? "contained" : "outlined"} onClick={() => explorer.setDrawing(!s.drawing)}>
                            {s.drawing ? "Drag a box on the map…" : "Draw on the map"}</Button>
                        <Button onClick={() => s.viewBbox && explorer.setBbox(s.viewBbox)} disabled={!s.viewBbox}>From map view</Button>
                        <Button disabled={!valid} onClick={() => explorer.setBbox(numbers as Bbox)}>Apply</Button>
                    </Stack>
                    <Typography variant="caption" color={s.bbox ? "text.secondary" : "warning.main"} component="div" sx={{mt: 0.5}}>
                        {s.bbox ? `${bboxSize(s.bbox)} · stays put while the map moves.` : "Draw a box, type its corners in degrees, or take the map view."}
                    </Typography>
                </Box>
            )}
        </Stack>
    );
}
