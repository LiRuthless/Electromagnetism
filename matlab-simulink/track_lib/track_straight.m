function trk = track_straight()
%TRACK_STRAIGHT 4 m 长直道（自检 [1][2][8] 用；导线从原点沿 +y）
trk.name   = 'straight4m';
trk.segs   = seg_line(4.0);
trk.closed = false;
end
