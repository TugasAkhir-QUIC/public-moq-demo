import subprocess

def get_ffprobe_output(file_path):
    command = [
        'ffprobe', '-select_streams', 'v:0', file_path, '-show_frames'
    ]
    result = subprocess.run(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    return result.stdout

def filter_iframes(ffprobe_output):
    iframe_info = []
    lines = ffprobe_output.split('\n')
    frame_data = {}
    inside_frame = False
    
    for line in lines:
        # Detect the start of a frame block
        if line.strip() == "[FRAME]":
            inside_frame = True
            frame_data = {}
        # Detect the end of a frame block
        elif line.strip() == "[/FRAME]":
            inside_frame = False
            if frame_data.get('pict_type') == 'I':
                pts = frame_data.get('pts', 'N/A')
                pts_time = frame_data.get('pts_time', 'N/A')
                iframe_info.append(f"pict_type=I, pts_time={pts_time}, pts={pts}")
        # Process lines within a frame block
        elif inside_frame:
            if '=' in line:
                key, value = line.split('=', 1)
                frame_data[key.strip()] = value.strip()
    
    return iframe_info

def save_iframe_info_to_file(iframe_info, output_file):
    with open(output_file, 'w') as file:
        for iframe in iframe_info:
            file.write(f"{iframe}\n")

# Example usage
file_path = 'source.mp4'  # Replace with your MP4 file path
output_file = 'iframe_info.txt'
ffprobe_output = get_ffprobe_output(file_path)
iframe_info = filter_iframes(ffprobe_output)
save_iframe_info_to_file(iframe_info, output_file)

print(f"I-frame information has been saved to {output_file}")