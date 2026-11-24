import SwiftUI
import Charts

struct HistoryView: View {
    @ObservedObject var model: PanelModel
    let theme: PanelTheme
    @ObservedObject var selection: HistorySelection

    private var inspected: PlotPoint? { selection.inspected }
    private var points: [PlotPoint] {
        guard let history = model.history else { return [] }
        if model.days == 0 && history.cycle?.available != true { return [] }
        return allowancePlot(history.history)
    }
    private let unit = "% remaining"
    private let plotHeight: CGFloat = 152

    var body: some View {
        VStack(alignment: .leading, spacing: 9) {
            HStack(spacing: 8) {
                Text("Allowance history").font(.system(size: 12.5, weight: .semibold))
                Spacer()
                Picker("History range", selection: $model.days) {
                    Text("Current").tag(0)
                    Text("7 days").tag(7)
                    Text("30 days").tag(30)
                    Text("90 days").tag(90)
                }
                .labelsHidden()
                .controlSize(.small)
                .fixedSize()
            }

            Group {
                if points.isEmpty {
                    VStack(spacing: 5) {
                        Image(systemName: "chart.xyaxis.line").font(.system(size: 20)).foregroundStyle(theme.accent)
                        Text(model.historyBusy ? "Loading history…" : model.historyUnavailable ? "History unavailable" : "No readings in this range")
                            .font(.system(size: 12.5, weight: .medium))
                        Text("Recorded quota readings appear here.").font(.system(size: 11)).foregroundStyle(theme.muted)
                    }
                    .frame(maxWidth: .infinity, minHeight: plotHeight)
                } else {
                    historyChart.frame(height: plotHeight)
                }
            }

            if !points.isEmpty {
                if let inspected {
                    Text("\(inspected.date.formatted(date: .abbreviated, time: .shortened)) · \(inspected.value.formatted(.number.precision(.fractionLength(0...1)))) \(unit)")
                        .font(.system(size: 11, weight: .medium))
                        .monospacedDigit()
                } else {
                    Text("Recorded readings · gaps and resets break the line · hover to inspect")
                        .font(.system(size: 10.5))
                        .foregroundStyle(theme.muted)
                        .lineLimit(1)
                }
            }
        }
        .onChange(of: model.days) { _ in selection.inspected = nil; Task { await model.updateHistory(force: true) } }
        .onChange(of: model.selectedWindow) { _ in selection.inspected = nil; Task { await model.updateHistory(force: true) } }
        .onChange(of: model.historyBusy) { _ in selection.inspected = nil }
    }

    private var historyChart: some View {
        Chart(points) { point in
            LineMark(x: .value("Date", point.date), y: .value(unit, point.value), series: .value("Continuity", point.segment))
                .foregroundStyle(theme.prismGradient)
                .lineStyle(StrokeStyle(lineWidth: 2.1, lineCap: .round))
            PointMark(x: .value("Date", point.date), y: .value(unit, point.value))
                .foregroundStyle(theme.accent)
                .symbolSize(points.count < 80 ? 10 : 3)
            if let inspected, inspected.id == point.id {
                RuleMark(x: .value("Date", point.date)).foregroundStyle(theme.accent.opacity(0.4))
                PointMark(x: .value("Date", point.date), y: .value(unit, point.value))
                    .foregroundStyle(theme.mint)
                    .symbolSize(40)
            }
        }
        .chartYScale(domain: 0...100)
        .chartXScale(range: .plotDimension(padding: 16))
        .chartYAxis {
            AxisMarks(position: .leading, values: [0, 50, 100]) { value in
                AxisGridLine(stroke: StrokeStyle(lineWidth: 0.7, dash: [3, 4])).foregroundStyle(theme.line)
                AxisValueLabel {
                    if let number = value.as(Double.self) {
                        Text(number.formatted(.number.precision(.fractionLength(0))))
                            .font(.system(size: 10.5))
                            .foregroundStyle(theme.muted)
                    }
                }
            }
        }
        .chartXAxis {
            AxisMarks(values: .automatic(desiredCount: 3)) { value in
                AxisValueLabel {
                    if let date = value.as(Date.self) {
                        let short = (points.last?.date.timeIntervalSince(points.first?.date ?? .now) ?? 0) < 172_800
                        Text(date.formatted(short ? .dateTime.hour().minute() : .dateTime.month(.abbreviated).day()))
                            .font(.system(size: 10.5))
                            .foregroundStyle(theme.muted)
                    }
                }
            }
        }
        .chartOverlay { proxy in
            GeometryReader { geometry in
                let inspect: (CGPoint) -> Void = { location in
                    let frame = geometry[proxy.plotAreaFrame]
                    guard frame.contains(location), let date: Date = proxy.value(atX: location.x - frame.minX) else {
                        selection.inspected = nil
                        return
                    }
                    selection.inspected = points.min { abs($0.date.timeIntervalSince(date)) < abs($1.date.timeIntervalSince(date)) }
                }
                Rectangle().fill(.clear).contentShape(Rectangle())
                    .onContinuousHover { phase in
                        switch phase {
                        case .active(let location): inspect(location)
                        case .ended: selection.inspected = nil
                        }
                    }
                    .gesture(DragGesture(minimumDistance: 0).onChanged { inspect($0.location) })
            }
        }
        .accessibilityLabel("Remaining allowance history")
    }
}
