import type {ReactNode} from "react";
import {Autocomplete, Box, Checkbox, Chip, TextField, Tooltip, Typography} from "@mui/material";
import {formatNote, kindOf, type FormatOption} from "../formats.js";

/**
 * Formats to choose from, searchable and grouped, with how many assets (or collections) have each. None preferred:
 * the user picks; picking none keeps everything. The media types behind each format are in its tooltip.
 */
export function FormatPicker({options, value, onChange, unit, loading, caption}: {
    options: FormatOption[]; value: string[]; onChange: (v: string[]) => void;
    /** What `count` counts: "asset" or "collection". */
    unit: string; loading?: boolean; caption?: ReactNode;
}) {
    const by = new Map(options.map((o) => [o.format, o]));
    // Chosen formats stay listed even when the options do not have them (yet).
    const names = [...options.map((o) => o.format), ...value.filter((v) => !by.has(v))];
    return (
        <Box>
            <Autocomplete multiple disableCloseOnSelect options={names} value={value} onChange={(_e, v) => onChange(v)}
                groupBy={kindOf} loading={loading}
                renderOption={(props, option, {selected}) => {
                    const o = by.get(option), note = formatNote(option);
                    const {key, ...rest} = props as typeof props & { key?: string };
                    return (
                        <Tooltip key={key ?? option} placement="right" title={<>
                            {note && <div>{note}</div>}
                            {o && <div style={{fontFamily: "JetBrains Mono, monospace", marginTop: note ? 4 : 0}}>{o.mediaTypes.map((t) => <div key={t}>{t}</div>)}</div>}
                        </>}>
                            <Box component="li" {...rest}>
                                <Checkbox size="small" checked={selected} sx={{mr: 1, p: 0.25}}/>
                                <Box sx={{flex: 1, minWidth: 0}}>
                                    <Typography variant="body2">{option}</Typography>
                                    {option === "GeoTIFF" && <Typography variant="caption" color="text.secondary" component="div">COG not declared: may or may not be one</Typography>}
                                </Box>
                                <Typography variant="caption" color="text.secondary">{o ? `${o.count} ${unit}${o.count === 1 ? "" : "s"}` : "none seen"}</Typography>
                            </Box>
                        </Tooltip>
                    );
                }}
                renderValue={(selected, getItemProps) => selected.map((option, index) => <Chip {...getItemProps({index})} key={option} label={option} color="primary" variant="outlined"/>)}
                renderInput={(params) => <TextField {...params} label="Formats" placeholder={value.length ? "" : `Any format (${options.length} found)`}/>}
            />
            {caption && <Typography variant="caption" color="text.secondary" component="div" sx={{mt: 0.5}}>{caption}</Typography>}
        </Box>
    );
}
