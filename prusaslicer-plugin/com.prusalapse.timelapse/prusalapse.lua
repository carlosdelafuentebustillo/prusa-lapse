-- Prusa-lapse Parked Timelapse Plugin for PrusaSlicer 3.0+
-- Configures printer_presets layer_gcode before slicing so every layer change
-- parks the printhead, triggers Prusa-lapse capture, and lets PrusaSlicer
-- automatically return to the exact start XY/Z of the next layer.

info = {
    id = "parked_timelapse",
    type = "project.plugin",
    title = "Configure Parked Timelapse",
    menu = "Prusa-lapse/Configure Parked Timelapse",
    params = {
        {
            name = "park_x",
            label = "Park X Position (mm)",
            type = "float",
            default = 240.0
        },
        {
            name = "park_y",
            label = "Park Y Position (mm)",
            type = "float",
            default = 210.0
        },
        {
            name = "z_hop",
            label = "Z-Hop Lift (mm)",
            type = "float",
            default = 0.4
        },
        {
            name = "settle_ms",
            label = "Vibration Settle Delay (ms)",
            type = "int",
            default = 300
        },
        {
            name = "capture_ms",
            label = "Camera Capture Wait (ms)",
            type = "int",
            default = 1200
        },
        {
            name = "clear_only",
            label = "Remove Timelapse From Project",
            type = "bool",
            default = false
        }
    }
}

function execute(opts)
    local bed = api.project:current_bed()
    local layer_height = bed:print_presets():value("layer_height") or 0.2

    api.project:clear_layer_custom_steps(bed)

    if opts.clear_only then
        bed:printer_presets():set("layer_gcode", ";AFTER_LAYER_CHANGE\n;[layer_z]\n")
        return
    end

    local park_x = math.floor((opts.park_x or 240.0) * 10 + 0.5) / 10
    local park_y = math.floor((opts.park_y or 210.0) * 10 + 0.5) / 10
    local z_hop = math.floor((opts.z_hop or 0.4) * 100 + 0.5) / 100
    local settle_ms = math.floor((opts.settle_ms or 300) + 0.5)
    local capture_ms = math.floor((opts.capture_ms or 1200) + 0.5)

    local layer_gcode = ";AFTER_LAYER_CHANGE\n;[layer_z]\n"
        .. "{if layer_num > 0}\n"
        .. "; --- PRUSA-LAPSE START ---\n"
        .. "G91 ; Relative positioning for Z-hop\n"
        .. "G1 Z" .. z_hop .. " F600 ; Z-hop lift\n"
        .. "G90 ; Return to absolute positioning\n"
        .. "M83 ; Relative extrusion\n"
        .. "G1 X" .. park_x .. " Y" .. park_y .. " F9000 ; Move to park position\n"
        .. "G4 P" .. settle_ms .. " ; Wait for vibrations to settle\n"
        .. "M220 S99 ; Trigger Prusa-lapse capture via PrusaLink speed factor\n"
        .. "G4 P" .. capture_ms .. " ; Wait for camera capture\n"
        .. "M220 S100 ; Restore 100% speed factor\n"
        .. "; --- PRUSA-LAPSE END ---\n"
        .. "{endif}\n"

    bed:printer_presets():set("layer_gcode", layer_gcode)
    api.project:insert_layer_custom_gcode(bed, layer_height * 2, "; PRUSA-LAPSE PARKED TIMELAPSE ENABLED")
end
