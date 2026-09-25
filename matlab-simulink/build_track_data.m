function TD = build_track_data(trackName, P)
%BUILD_TRACK_DATA 由赛道名构建仿真用数据结构 TD。
%   wires/mids/dls  场计算单元（直线闭式 + 圆弧离散，§4.2/§5）
%   path            中线采样（5 mm 步进，点列/切向/累计弧长）
%   length          中线总长 m；closed 闭环标志
trk = feval(trackName);   % track_lib/ 中的赛道函数
[wires, mids, dls] = em_buildFieldElements(trk.segs, trk.closed, P.MAX_DS);
path = em_samplePath(trk.segs, trk.closed, 0.005);

% MATLAB Function 块输入不宜为空矩阵：补"零贡献"哑元（dl=0 / 零长线段）
if isempty(mids)
    mids = [0 0 0];
    dls  = [0 0 0];
end
if isempty(wires)
    wires = [0 0 0 0];
end

TD = struct('name', trk.name, 'segs', {trk.segs}, 'closed', trk.closed, ...
    'wires', wires, 'mids', mids, 'dls', dls, 'path', path, 'length', path.len);
end
